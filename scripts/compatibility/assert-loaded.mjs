/* eslint-disable no-console */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const APP_TYPES = new Set(['interface', 'display', 'layout', 'module', 'panel', 'item-view']);
const SERVER_TYPES = new Set(['hook', 'endpoint']);
const HYBRID_TYPES = new Set(['operation']);

// The generated app entrypoint pushes a bundle's app entries into per-type
// collections. Asserting those push lines is how a bundle's app side is proven
// discovered, since the diagnostics entries list carries server entries only.
const BUNDLE_APP_COLLECTIONS = {
	interface: 'interfaces',
	display: 'displays',
	layout: 'layouts',
	module: 'modules',
	panel: 'panels',
	'item-view': 'itemViews',
};

const BASE_URL = process.env.CAIRNCMS_URL;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

if (!BASE_URL || !EMAIL || !PASSWORD) {
	console.error('CAIRNCMS_URL, ADMIN_EMAIL, and ADMIN_PASSWORD are required.');
	process.exit(1);
}

function readPackages() {
	const packagesDir = join(fileURLToPath(new URL('../../', import.meta.url)), 'packages');
	const packages = [];

	for (const folder of readdirSync(packagesDir)) {
		const path = join(packagesDir, folder);
		if (!statSync(path).isDirectory()) continue;

		const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
		const extension = manifest['cairncms:extension'] ?? {};

		packages.push({
			name: manifest.name,
			type: extension.type,
			entries: Array.isArray(extension.entries) ? extension.entries : [],
			hasSettings: extension.settings !== undefined,
		});
	}

	return packages;
}

async function api(path, init) {
	const response = await fetch(`${BASE_URL}${path}`, init);

	if (!response.ok) {
		throw new Error(`${path} responded ${response.status}`);
	}

	return (await response.json()).data;
}

async function apiText(path, init) {
	const response = await fetch(`${BASE_URL}${path}`, init);

	if (!response.ok) {
		throw new Error(`${path} responded ${response.status}`);
	}

	return await response.text();
}

function describe(entry) {
	const reason = entry?.reason ? ` (${entry.reason.code ?? 'unknown'}: ${entry.reason.detail ?? ''})` : '';
	return `${entry?.status ?? 'absent'}${reason}`;
}

const packages = readPackages();

if (packages.length === 0) {
	console.error('No packages found to assert. The compatibility check expects at least one package.');
	process.exit(1);
}

const login = await api('/auth/login', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});

const headers = { Authorization: `Bearer ${login.access_token}` };
const extensions = await api('/extensions', { headers });

let owners = null;
let ownersUnavailable = '';

try {
	owners = await api('/extension-settings/owners', { headers });
} catch (error) {
	ownersUnavailable = `owners endpoint unavailable on this instance (${error.message})`;
}

let appSources = null;

async function getAppSources() {
	if (appSources === null) {
		appSources = await apiText('/extensions/sources/index.js', { headers });
	}

	return appSources;
}

const failures = [];

function expectedStatus(type) {
	if (APP_TYPES.has(type)) return 'discovered';
	if (SERVER_TYPES.has(type)) return 'loaded';
	return null;
}

function settingsCheck(pkg) {
	if (!pkg.hasSettings) return { ok: true, note: '' };

	// A package that declares settings cannot pass when the owners surface is
	// unavailable, or a broken settings endpoint would report a green run.
	if (owners === null) {
		return { ok: false, note: `, settings unverifiable: ${ownersUnavailable}` };
	}

	const owner = owners.find((candidate) => candidate.subject === pkg.name);
	const ok = owner?.status === 'available';

	return { ok, note: ok ? ', settings available' : `, settings ${owner?.status ?? 'absent'}` };
}

async function assertBundle(pkg) {
	const row = extensions.find((candidate) => candidate.name === pkg.name);
	const serverEntries = pkg.entries.filter((entry) => SERVER_TYPES.has(entry.type));
	const appEntries = pkg.entries.filter((entry) => APP_TYPES.has(entry.type));
	const unsupported = pkg.entries.filter((entry) => !SERVER_TYPES.has(entry.type) && !APP_TYPES.has(entry.type));
	const problems = [];

	for (const entry of unsupported) {
		problems.push(`entry "${entry.name}" has type "${entry.type}"; extend scripts/compatibility/assert-loaded.mjs`);
	}

	const expected = serverEntries.length > 0 ? 'loaded' : 'discovered';

	if (row?.status !== expected) {
		problems.push(`status ${describe(row)}, expected "${expected}"`);
	}

	for (const entry of serverEntries) {
		const entryRow = row?.entries?.find((candidate) => candidate.name === entry.name);

		if (entryRow?.status !== 'loaded') {
			problems.push(`server entry "${entry.name}" is ${describe(entryRow)}, expected "loaded"`);
		}
	}

	if (appEntries.length > 0) {
		let sources = '';

		try {
			sources = await getAppSources();
		} catch (error) {
			problems.push(`app sources unavailable (${error.message})`);
		}

		if (sources !== '') {
			if (!sources.includes(`loadExtension("${pkg.name}"`)) {
				problems.push('app side is not referenced by the generated app entrypoint');
			}

			for (const entry of appEntries) {
				const collection = BUNDLE_APP_COLLECTIONS[entry.type];

				if (!sources.includes(`pushEntries("${pkg.name}", ${collection}`)) {
					problems.push(`app entry "${entry.name}" (${entry.type}) is not registered into "${collection}"`);
				}
			}
		}
	}

	const settings = settingsCheck(pkg);
	if (!settings.ok) problems.push('settings owner not available');

	const summary = `bundle ${describe(row)}, ${serverEntries.length} server, ${appEntries.length} app${settings.note}`;

	if (problems.length === 0) {
		console.log(`ok   ${pkg.name} (${summary})`);
	} else {
		console.log(`FAIL ${pkg.name} (${summary})`);
		for (const problem of problems) failures.push(`${pkg.name}: ${problem}`);
	}
}

// An operation has one diagnostics row, loaded once its server side registers.
// Its app side can only be shown referenced: the entrypoint carries these lines
// even when the browser fails to import the app module.
async function assertOperation(pkg) {
	const row = extensions.find((candidate) => candidate.name === pkg.name);
	const problems = [];

	if (row?.status !== 'loaded') {
		problems.push(`status ${describe(row)}, expected "loaded"`);
	}

	let sources = null;

	try {
		sources = await getAppSources();
	} catch (error) {
		problems.push(`app sources unavailable (${error.message})`);
	}

	const loads = sources?.includes(`loadExtension("${pkg.name}"`) ?? false;
	const pushes = sources?.includes(`pushConfig("${pkg.name}", operations`) ?? false;

	if (sources !== null && !loads) {
		problems.push('app side is not referenced by the generated app entrypoint');
	}

	if (sources !== null && !pushes) {
		problems.push('app side is not pushed into "operations" by the generated app entrypoint');
	}

	const settings = settingsCheck(pkg);
	if (!settings.ok) problems.push('settings owner not available');

	const app = loads && pushes ? 'referenced' : 'not referenced';
	const summary = `operation ${describe(row)}, app ${app}${settings.note}`;

	if (problems.length === 0) {
		console.log(`ok   ${pkg.name} (${summary})`);
	} else {
		console.log(`FAIL ${pkg.name} (${summary})`);
		for (const problem of problems) failures.push(`${pkg.name}: ${problem}`);
	}
}

for (const pkg of packages) {
	if (pkg.type === 'bundle') {
		await assertBundle(pkg);
		continue;
	}

	if (HYBRID_TYPES.has(pkg.type)) {
		await assertOperation(pkg);
		continue;
	}

	const expected = expectedStatus(pkg.type);

	if (expected === null) {
		failures.push(`${pkg.name}: type "${pkg.type}" is not supported; extend scripts/compatibility/assert-loaded.mjs`);
		console.log(`FAIL ${pkg.name} (unsupported type "${pkg.type}")`);
		continue;
	}

	const entry = extensions.find((candidate) => candidate.name === pkg.name);
	const statusOk = entry?.status === expected;
	const settings = settingsCheck(pkg);

	if (statusOk && settings.ok) {
		console.log(`ok   ${pkg.name} (${pkg.type} ${entry.status}${settings.note})`);
	} else {
		console.log(`FAIL ${pkg.name} (${pkg.type} ${describe(entry)}${settings.note})`);
		if (!statusOk) failures.push(`${pkg.name}: status ${describe(entry)}, expected "${expected}"`);
		if (!settings.ok) failures.push(`${pkg.name}: settings owner not available`);
	}
}

for (const entry of extensions) {
	if (entry.status === 'failed' && !packages.some((pkg) => pkg.name === entry.name)) {
		failures.push(`unexpected failed extension on the instance: ${entry.name} ${describe(entry)}`);
	}
}

if (failures.length > 0) {
	console.error(`\n${failures.length} assertion(s) failed:`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log(`\nAll ${packages.length} package(s) healthy.`);
