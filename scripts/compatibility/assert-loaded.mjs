/* eslint-disable no-console */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const APP_TYPES = new Set(['interface', 'display', 'layout', 'module', 'panel', 'item-view']);
const SERVER_TYPES = new Set(['hook', 'endpoint']);

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

const failures = [];

function expectedStatus(type) {
	if (APP_TYPES.has(type)) return 'discovered';
	if (SERVER_TYPES.has(type)) return 'loaded';
	return null;
}

for (const pkg of packages) {
	const expected = expectedStatus(pkg.type);

	if (expected === null) {
		failures.push(`${pkg.name}: type "${pkg.type}" is not supported; extend scripts/compatibility/assert-loaded.mjs`);
		console.log(`FAIL ${pkg.name} (unsupported type "${pkg.type}")`);
		continue;
	}

	const entry = extensions.find((candidate) => candidate.name === pkg.name);
	const statusOk = entry?.status === expected;

	let settingsOk = true;
	let settingsNote = '';

	if (pkg.hasSettings) {
		const owner = owners?.find((candidate) => candidate.subject === pkg.name);
		settingsOk = owner?.status === 'available';

		if (owners === null) {
			settingsNote = `, settings unverifiable: ${ownersUnavailable}`;
		} else {
			settingsNote = settingsOk ? ', settings available' : `, settings ${owner?.status ?? 'absent'}`;
		}
	}

	if (statusOk && settingsOk) {
		console.log(`ok   ${pkg.name} (${pkg.type} ${entry.status}${settingsNote})`);
	} else {
		console.log(`FAIL ${pkg.name} (${pkg.type} ${describe(entry)}${settingsNote})`);
		if (!statusOk) failures.push(`${pkg.name}: status ${describe(entry)}, expected "${expected}"`);
		if (!settingsOk) failures.push(`${pkg.name}: settings owner not available`);
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
