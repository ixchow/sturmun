
//based on amobeba escape's audio system

const AUDIO = {
	muted:false,
	interacted:false,
	levelMusic:["mellow.opus",0.8],
	danceMusic:["jam.opus",0.8],
	collect:["star.opus",1.0],
};

AUDIO.load = function AUDIO_load() {
	AUDIO.pending = 0;
	for (let n in AUDIO) {
		if (Array.isArray(AUDIO[n])) {
			AUDIO.pending += 1;
			const name = AUDIO[n][0];
			const volume = AUDIO[n][1];
			let a = new Audio();
			a.src = name;
			a.volume = volume;
			AUDIO[n] = a;
			a.oneshot = function() {
				if (!AUDIO.interacted) return;
				this.loop = false;
				this.pause();
				this.currentTime = 0;
				console.log(`Playing ${name}`); //DEBUG
				this.play();
			};
			a.forever = function() {
				if (!AUDIO.interacted) return;
				this.loop = true;
				this.pause();
				this.currentTime = 0;
				console.log(`Playing (forever) ${name}`); //DEBUG
				this.play();
			};
			let loaded = (evt) => {
				a.RemoveEvent
				console.log(`Loaded ${name}.`);
				AUDIO.pending -= 1;
				a.removeEventListener('canplay', loaded);
			};
			a.addEventListener('canplay', loaded);
		}
	}
};

AUDIO.mute = function AUDIO_mute() {
	if (!this.muted) {
		this.muted = true;
		for (const a in this) {
			if (typeof(this[a]) === "object") {
				this[a].muted = true;
			}
		}
	} else {
		this.muted = false;
		for (const a in this) {
			if (typeof(this[a]) === "object") {
				this[a].muted = false;
			}
		}
	}
};
