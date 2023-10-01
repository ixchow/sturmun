
//based on amobeba escape's audio system

const AUDIO = {
	muted:false,
	//levelMusic:"music.wav",
	//danceMusic:"win.wav",
	//collect:"click.wav",
};

AUDIO.load = function AUDIO_load() {
	AUDIO.pending = 0;
	for (let n in AUDIO) {
		if (typeof(AUDIO[n]) === "string") {
			AUDIO.pending += 1;
			let a = new Audio();
			a.src = AUDIO[n];
			AUDIO[n] = a;
			a.oneshot = function() {
				this.loop = false;
				this.pause();
				this.currentTime = 0;
				this.play();
			};
			a.forever = function() {
				this.loop = true;
				this.pause();
				this.currentTime = 0;
				this.play();
			};
			a.onload = function() {
				AUDIO.pending -= 1;
			}
		}
	}
};

AUDIO.mute = function AUDIO_mute() {
	if (!this.muted) {
		this.muted = true;
		for (const a in this) {
			if (typeof(a) === "object") {
				a.oldVolume = a.volume;
				a.volume = 0.0;
			}
		}
	} else {
		this.muted = false;
		for (const a in this) {
			if (typeof(a) === "object") {
				a.volume = a.oldVolume;
				delete a.oldVolume;
			}
		}
	}
};
