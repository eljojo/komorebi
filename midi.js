// midi.js — Web MIDI for the editor: parse CC, hold session bindings, MIDI-learn,
// soft takeover. Pure [0,1] logic + a thin navigator.requestMIDIAccess wiring in
// start(). No DOM; editor.js maps [0,1] to each slider's range.
// (spec: docs/superpowers/specs/2026-06-16-web-midi-mapping-design.md)

const ccId = (channel, cc) => `${channel}:${cc}`;

// Decode a raw MIDI data array into a Control-Change event, or null for anything else.
export function parseCC(data) {
	if (!data || data.length < 3) return null;
	if ((data[0] & 0xf0) !== 0xb0) return null; // 0xB_ = Control Change
	return { channel: data[0] & 0x0f, cc: data[1], value: data[2] };
}

export function createMidi({ setNorm, getNorm, onBind }) {
	const bindings = new Map(); // ccId -> { key, label, captured, side }
	let armedKey = null;
	let status = "unsupported";
	const statusFns = [];
	const setStatus = (s) => {
		status = s;
		for (const f of statusFns) f(s);
	};

	function bound(key) {
		for (const b of bindings.values()) if (b.key === key) return b.label;
		return null;
	}
	function unbind(key) {
		for (const [id, b] of bindings) if (b.key === key) bindings.delete(id);
	}

	// Soft takeover: while a binding hasn't been captured, hold the slider until the
	// knob crosses its current value (the side flips), then track every message. `side`
	// is the knob's position relative to the slider, seeded at bind time.
	function applyValue(b, n) {
		if (!b.captured) {
			const cur = getNorm(b.key);
			const side = Math.sign(n - cur); // which side of the slider the knob is on
			if (side === 0) {
				b.captured = true;
				b.side = undefined;
			} // exactly at value → grab
			else if (b.side === undefined) {
				b.side = side;
				return;
			} // first sample → record, wait
			else if (side === b.side)
				return; // same side → keep waiting
			else {
				b.captured = true;
				b.side = undefined;
			} // crossed → grab it
		}
		setNorm(b.key, n);
	}

	function ingest(ev) {
		// ev = { channel, cc, value }
		const id = ccId(ev.channel, ev.cc);
		if (armedKey !== null) {
			unbind(armedKey); // one CC per key
			const label = `cc${ev.cc}`;
			const side = Math.sign(ev.value / 127 - getNorm(armedKey)); // seed takeover from where the knob sits now
			bindings.set(id, {
				key: armedKey,
				label,
				captured: side === 0,
				side: side === 0 ? undefined : side,
			});
			const key = armedKey;
			armedKey = null;
			onBind(key, label);
			return;
		}
		const b = bindings.get(id);
		if (!b) return;
		applyValue(b, ev.value / 127);
	}

	function feed(data) {
		const ev = parseCC(data);
		if (ev) ingest(ev);
	}

	async function start(
		req = typeof navigator !== "undefined" && navigator.requestMIDIAccess
			? navigator.requestMIDIAccess.bind(navigator)
			: null,
	) {
		if (!req) {
			setStatus("unsupported");
			return;
		}
		let access;
		try {
			access = await req({ sysex: false });
		} catch {
			setStatus("permission denied");
			return;
		}
		const wire = () => {
			const inputs = [...access.inputs.values()];
			for (const input of inputs) input.onmidimessage = (e) => feed(e.data);
			setStatus(inputs.length ? `${inputs[0].name} connected` : "no device");
		};
		access.onstatechange = wire;
		wire();
	}

	return {
		start,
		feed,
		bound,
		unbind,
		arm: (key) => {
			armedKey = key;
		},
		disarm: () => {
			armedKey = null;
		},
		recapture: (key) => {
			for (const b of bindings.values())
				if (b.key === key) {
					b.captured = false;
					b.side = undefined;
				}
		},
		onStatusChange: (f) => {
			statusFns.push(f);
		},
		get status() {
			return status;
		},
	};
}
