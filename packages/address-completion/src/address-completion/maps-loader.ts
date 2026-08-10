const READY_CALLBACK = '__cairncmsAddressCompletionMapsReady';

let mapsPromise: Promise<void> | null = null;

export function loadGoogleMaps(browserKey: string): Promise<void> {
	if (mapsPromise === null) {
		mapsPromise = new Promise<void>((resolve, reject) => {
			const holder = window as unknown as Record<string, unknown>;

			holder[READY_CALLBACK] = () => {
				delete holder[READY_CALLBACK];
				resolve();
			};

			const params = new URLSearchParams({
				key: browserKey,
				v: 'quarterly',
				libraries: 'maps,marker',
				loading: 'async',
				callback: READY_CALLBACK,
			});

			const script = document.createElement('script');
			script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
			script.async = true;

			script.onerror = () => {
				delete holder[READY_CALLBACK];
				reject(new Error('the Google Maps script failed to load'));
			};

			document.head.appendChild(script);
		}).catch((error: unknown) => {
			mapsPromise = null;
			throw error;
		});
	}

	return mapsPromise;
}
