"use strict";

//with reference to gridwords' gl stuff, which in turn builds on:
//the MDN webGL tutorials:
// https://threejs.org/build/three.min.js
//and also based on the 15-466-f18 notes:
// http://graphics.cs.cmu.edu/courses/15-466-f18/notes/gl-helpers.js
// http://graphics.cs.cmu.edu/courses/15-466-f18/notes/brdf-toy.html
//and some helpers from on-forgetting:
// https://github.com/ixchow/on-forgetting

const CANVAS = document.getElementsByTagName("canvas")[0];
const gl = CANVAS.getContext("webgl", {
	alpha:false,
	depth:false,
	stencil:false,
	preserveDrawingBuffer:false,
	antialias:false,
} );
if (gl === null) {
	alert("Unable to init webgl");
	throw new Error("Init failed.");
}

SHADERS.load();
TEXTURES.load();
AUDIO.load();

const TICK = 1.0 / 120.0;

class Match {
	constructor(indices, targets, limb) {
		this.indices = indices.slice();

		this.targets = [];

		let acc = [0,0];
		for (const t of targets) {
			acc[0] += t[0];
			acc[1] += t[1];
		}
		acc[0] /= targets.length;
		acc[1] /= targets.length;

		for (const t of targets) {
			this.targets.push([t[0] - acc[0], t[1] - acc[1]]);
		}

		this.limb = limb;
		this.xScale = 1.0;
		this.weight = 1.0;
	}
	fit(positions) {
		const avg = [0,0];
		for (let i = 0; i < this.indices.length; ++i) {
			const p = positions[this.indices[i]];
			avg[0] += p[0];
			avg[1] += p[1];
		}
		avg[0] /= this.indices.length;
		avg[1] /= this.indices.length;

		//want to minimize:
		// ( R * (ind - avg) - target)^2

		//according to https://igl.ethz.ch/projects/ARAP/svd_rot.pdf
		//this implies:

		// R = svd((ind-avg) * target^t) -> VU^T

		let cov = [0,0,0,0]; //n.b. *row* major
		for (let i = 0; i < this.indices.length; ++i) {
			const p = positions[this.indices[i]];
			const t = [this.xScale * this.targets[i][0], this.targets[i][1]];
			const diff = [p[0]-avg[0], p[1]-avg[1]];
			cov[0] += diff[0] * t[0];
			cov[1] += diff[0] * t[1];
			cov[2] += diff[1] * t[0];
			cov[3] += diff[1] * t[1];
		}


		let svd_ang;
		{ //2x2 svd from: https://scicomp.stackexchange.com/questions/8899/robust-algorithm-for-2-times-2-svd
			const E = (cov[0] + cov[3]) / 2;
			const H = (cov[1] - cov[2]) / 2;
			const a2 = Math.atan2(H,E);
			svd_ang = a2;
		}


		/*

		//DEBUG: test angles directly
		let best = Infinity;
		let best_ang = -1;
		for (let a = 0; a < 1000; ++a) {
			const ang = a / 1000.0 * 2.0 * Math.PI;
			const c = Math.cos(ang);
			const s = Math.sin(ang);

			let test = 0.0;
			for (let i = 0; i < this.indices.length; ++i) {
				const p = positions[this.indices[i]];
				const t = [this.xScale * this.targets[i][0], this.targets[i][1]];
				const diff = [p[0]-avg[0],p[1]-avg[1]];

				test += (diff[0] * c + diff[1] * -s - t[0])**2;
				test += (diff[0] * s + diff[1] *  c - t[1])**2;
			}
			if (test < best) {
				best = test;
				best_ang = ang;
			}
		}

		console.assert(best_ang !== -1, "something must work");
		*/

		const c = Math.cos(-svd_ang);
		const s = Math.sin(-svd_ang);

		return [
			this.xScale*c,this.xScale*s,
			-s,c,
			avg[0], avg[1]
		];

	}
}

class Capsule {
	constructor(r,a,b) {
		this.r = r;
		this.a = a.slice();
		this.b = b.slice();

		this.length = Math.sqrt( (this.b[0] - this.a[0]) ** 2 + (this.b[1] - this.a[1]) ** 2);

		this.along = [
			(this.b[0] - this.a[0]) / this.length,
			(this.b[1] - this.a[1]) / this.length
		];
		this.perp = [
			-this.along[1],
			 this.along[0]
		];
	}

	collide(p) {
		let along = (p[0] - this.a[0]) * this.along[0] + (p[1] - this.a[1]) * this.along[1];
		along = Math.max(0, along);
		along = Math.min(along, this.length);

		const t = along / this.length;

		const close = [
			t * (this.b[0] - this.a[0]) + this.a[0],
			t * (this.b[1] - this.a[1]) + this.a[1],
		];

		const len2 = (p[0] - close[0]) ** 2 + (p[1] - close[1]) ** 2;

		if (len2 > this.r ** 2) return;

		const len = Math.sqrt(len2);

		return {
			depth:this.r - len,
			out:[ (p[0] - close[0]) / len, (p[1] - close[1]) / len ]
		};
	}
}

const TARGET_RAD = 0.7;

class Target {
	constructor(at) {
		this.at = at.slice();
		this.fade = 1.0;
		this.angle = 0.0;
		this.acc = Math.random();
	}
	check(p) {
		const dis2 = (p[0] - this.at[0]) ** 2 + (p[1] - this.at[1]) ** 2;
		return dis2 < TARGET_RAD ** 2;
	}
}

const LIMB_SEGS = 5;

const DEBUG_DRAW = false;
const TEXTURE_CAPTURE_MODE = false;

class World {
	constructor(level) {
		this.acc = 0.0;
		this.positions = [];
		this.prevPositions = [];
		this.matches = [];

		this.won = false;

		//for each vertex, texture coordinate + blend of vertices:
		// [uv:[], blend:[idx,wt,idx,wt,idx,wt,...]]
		this.meshVertices = [];
		this.meshTristrip = []; //indexed

		//per-limb:
		this.totalLength = 0.1;
		this.growToLength = 1;
		this.limbs = [];
		for (let l = 0; l < 5; ++l) {
			this.limbs.push({
				length:this.totalLength/5,
				grow:false
			});
		}

		//used for computing UV locations for sturmun:
		let uvPositions = [];

		const buildLimb = (limb, angle) => {
			const SEGS = LIMB_SEGS;
			const along = [Math.cos(angle), Math.sin(angle)];
			const perp = [-along[1], along[0]];

			const S = 0.9; //start
			const W = 1.0; //segment width (unscaled)
			const UV_W = 0.5; //segment width (uv space)
			const w = (0.5 + limb.length) / SEGS;
			const R = 0.5; //radius

			let v0 = this.positions.length;
			this.positions.push([S * along[0] - R * perp[0], S * along[1] - R * perp[1]]);
			uvPositions.push([S * along[0] - R * perp[0], S * along[1] - R * perp[1]]);
			let v1 = this.positions.length;
			this.positions.push([S * along[0] + R * perp[0], S * along[1] + R * perp[1]]);
			uvPositions.push([S * along[0] + R * perp[0], S * along[1] + R * perp[1]]);

			this.meshVertices.push({wt:[v0,1.0]});
			this.meshVertices.push({wt:[v1,1.0]});


			if (this.meshTristrip.length) {
				this.meshTristrip.push(this.meshTristrip[this.meshTristrip.length-1]);
				this.meshTristrip.push(v0);
			}

			this.meshTristrip.push(v0, v1);

			for (let seg = 0; seg < SEGS; ++seg) {
				const s = S + w * (seg+1);
				const uv_s = S + UV_W * (seg+1);
				let n0 = this.positions.length;
				this.positions.push([s * along[0] - R * perp[0], s * along[1] - R * perp[1]]);
				uvPositions.push([uv_s * along[0] - R * perp[0], uv_s * along[1] - R * perp[1]]);
				let n1 = this.positions.length;
				this.positions.push([s * along[0] + R * perp[0], s * along[1] + R * perp[1]]);
				uvPositions.push([uv_s * along[0] + R * perp[0], uv_s * along[1] + R * perp[1]]);

				this.meshVertices.push({wt:[n0,1.0]});
				this.meshVertices.push({wt:[n1,1.0]});

				this.meshTristrip.push(n0, n1);

				let indices = [v0, n0, n1, v1];
				let targets = [ [0, -R], [W,-R], [W, R], [0, R] ];

				this.matches.push(new Match(indices, targets, limb));

				v0 = n0;
				v1 = n1;
			}

			{ //the tip:
				const s = S + w * SEGS + W;
				const uv_s = S + UV_W * SEGS + W;
				let vE = this.positions.length;
				this.positions.push([s * along[0], s * along[1]]);
				uvPositions.push([uv_s * along[0], uv_s * along[1]]);

				this.meshVertices.push({wt:[vE,1.0]});
				this.meshTristrip.push(vE,vE); //twice to preserve parity

				let indices = [v0, vE, v1];
				let targets = [ [0,-R], [W,0], [0,R] ];

				this.matches.push(new Match(indices, targets));
				this.matches[this.matches.length-1].weight = 1.0;
			}
		};

		let bodyIndices = [];
		for (let l = 0; l < 5; ++l) {
			bodyIndices.push(this.positions.length);
			bodyIndices.push(this.positions.length+1);
			buildLimb(this.limbs[l], (0.05 + l * 0.2) * 2.0 * Math.PI);
		}
		let bodyTargets = [];
		for (let v of bodyIndices) {
			bodyTargets.push(this.positions[v]);
		}
		this.matches.push(new Match(bodyIndices, bodyTargets));

		{ //body center:
			const vC = this.meshVertices.length;
			this.meshVertices.push({wt:[]});
			for (let v of bodyIndices) {
				this.meshVertices[this.meshVertices.length-1].wt.push(v, 1.0 / bodyIndices.length);
			}

			for (let i = 0; i < bodyIndices.length; ++i) {
				const v = bodyIndices[i];
				if (i === 0) this.meshTristrip.push(this.meshTristrip[this.meshTristrip.length-1]);
				this.meshTristrip.push(vC);
				if (i === 0) this.meshTristrip.push(this.meshTristrip[this.meshTristrip.length-1]);
				this.meshTristrip.push(v);
			}
			this.meshTristrip.push(vC);
			this.meshTristrip.push(bodyIndices[0]);
		}

		//assign uvs:
		{
			const S = 0.1;
			for (const mv of this.meshVertices) {
				let pos = [0,0];
				for (let i = 0; i + 1 < mv.wt.length; i += 2) {
					const src = uvPositions[mv.wt[i]];
					pos[0] += src[0] * mv.wt[i+1];
					pos[1] += src[1] * mv.wt[i+1];
				}
				mv.uv = [pos[0] * S + 0.5, -pos[1] * S + 0.5];
			}

			let min = [Infinity, Infinity];
			let max = [-Infinity,-Infinity];
			for (const mv of this.meshVertices) {
				min[0] = Math.min(min[0], mv.uv[0]);
				min[1] = Math.min(min[1], mv.uv[1]);
				max[0] = Math.max(max[0], mv.uv[0]);
				max[1] = Math.max(max[1], mv.uv[1]);
			}

			//console.log(`UV bounds: [${min[0]},${max[0]}]x[${min[1]},${max[1]}]`);

			if (TEXTURE_CAPTURE_MODE) {
				for (const p of uvPositions) {
					p[0] = p[0] * S + 0.5;
					p[1] = p[1] * S + 0.5;
				}
				this.positions = uvPositions;
			}
		}


		if (!TEXTURE_CAPTURE_MODE) {
			for (let p of this.positions) {
				p[0] += level.start[0];
				p[1] += level.start[1];
			}
		}

		this.start = level.start.slice(); //remember for camera, I guess

		this.prevPositions = this.positions.slice();

		this.capsules = [];

		for (let c of level.capsules) {
			this.capsules.push(new Capsule(c.r, c.a, c.b));
		}

		this.targets = [];

		for (let t of level.targets) {
			this.targets.push(new Target(t));
		}

		this.toDraw = [];
	}

	tick() {
		this.toDraw = [];

		if (TEXTURE_CAPTURE_MODE) {
			this.toDraw.push(0,0, 0,0,0,1);
			this.toDraw.push(0,1, 0,0,0,1);
			this.toDraw.push(0,1, 0,0,0,1);
			this.toDraw.push(1,1, 0,0,0,1);
			this.toDraw.push(1,1, 0,0,0,1);
			this.toDraw.push(1,0, 0,0,0,1);
			this.toDraw.push(1,0, 0,0,0,1);
			this.toDraw.push(0,0, 0,0,0,1);
			return;
		}

		{ //growth:
			this.totalLength = Math.min(
				this.growToLength,
				this.totalLength + TICK / 0.4
			);
		}


		{ //controls:
			let total = 0.0;
			for (const limb of this.limbs) {
				if (limb.grow) {
					limb.length += TICK * 10.0;
				}
				total += limb.length;
			}
			let factor = this.totalLength / total;
			for (const limb of this.limbs) {
				limb.length *= factor;
			}

			for (const match of this.matches) {
				if (typeof(match.limb) !== 'undefined') {
					match.xScale = (0.5 + match.limb.length) / (LIMB_SEGS);
				}
			}
		}

		//timestep:
		const nextPositions = [];
		const GRAVITY = -10.0;
		for (let i = 0; i < this.positions.length; ++i) {
			const prev = this.prevPositions[i];
			const at = this.positions[i];

			let vel = [(at[0]-prev[0])/TICK, (at[1]-prev[1])/TICK];

			vel[1] += GRAVITY * TICK;

			let next = [at[0] + TICK * vel[0], at[1] + TICK * vel[1]];

			nextPositions.push(next);
		}

		for (let iter = 0; iter < 1; ++iter) { //vs shape matching:
			const targets = [];
			for (let i = 0; i < nextPositions.length; ++i) {
				targets.push([0,0,0]); //accumulators, last is weight
			}
			for (const match of this.matches) {
				const xf = match.fit(nextPositions);
				for (let i = 0; i < match.indices.length; ++i) {
					const v = match.indices[i];
					const t = match.targets[i];
					const w = match.weight;
					targets[v][0] += w * (xf[0] * t[0] + xf[2] * t[1] + xf[4]);
					targets[v][1] += w * (xf[1] * t[0] + xf[3] * t[1] + xf[5]);
					targets[v][2] += w;
				}
			}
			for (let i = 0; i < nextPositions.length; ++i) {
				if (targets[i][2] === 0) {
					//no constraint
				} else {
					nextPositions[i][0] = targets[i][0] / targets[i][2];
					nextPositions[i][1] = targets[i][1] / targets[i][2];
				}
			}
		}

		//vs the ground:
		const COEF = 0.75;
		/*
		const GROUND = -2.0;
		for (let i = 0; i < nextPositions.length; ++i) {
			const prev = this.positions[i];
			const pos = nextPositions[i];
			if (pos[1] < GROUND) {
				if (prev[1] > pos[1]) {
					prev[1] = GROUND + COEF * (pos[1] - prev[1]);
					prev[0] = pos[0] + 0.5 * (prev[0] - pos[0]); //friction?
				}
				pos[1] = GROUND;
			}
		}*/

		//vs ground:
		let colliding = [];

		const resolve = (prev, pos, isect) => {
			const out = isect.out;
			const perp = [-out[1], out[0]];
			let vo = (pos[0] - prev[0]) * out[0]  + (pos[1] - prev[1]) * out[1];
			let vp = (pos[0] - prev[0]) * perp[0] + (pos[1] - prev[1]) * perp[1];

			if (DEBUG_DRAW) {
				this.toDraw.push(pos[0], pos[1], 1,0,0,1); //DEBUG
				this.toDraw.push(pos[0] + out[0], pos[1] + out[1], 1,0,0,1); //DEBUG
				this.toDraw.push(pos[0], pos[1], 0,1,0,1); //DEBUG
				this.toDraw.push(pos[0] + perp[0], pos[1] + perp[1], 0,1,0,1); //DEBUG
			}

			if (vo < 0.0) {
				const friction = 0.5 * Math.abs(vo);
				vo = COEF * -vo;

				//if (vp > 0) vp = Math.max(0, vp - friction);
				//else vp = Math.min(0, vp + friction);
				//vp = 0.5 * vp; //"friction"

				const ofs = 0.99 * isect.depth;

				pos[0] += ofs * out[0];
				pos[1] += ofs * out[1];
			}

			{ // "friction"
				vp *= 0.5;
			}

			prev[0] = pos[0] - (vo * out[0] + vp * perp[0]);
			prev[1] = pos[1] - (vo * out[1] + vp * perp[1]);
		};

		for (let i = 0; i < nextPositions.length; ++i) {
			const prev = this.positions[i];
			const pos = nextPositions[i];
			let isect;
			for (const capsule of this.capsules) {
				let test = capsule.collide(pos);
				if (typeof(test) !== 'undefined') {
					if (typeof(isect) === 'undefined' || isect.depth < test.depth) {
						isect = test;
					}
				}
			}
			if (typeof(isect) !== 'undefined') {
				resolve(prev, pos, isect);
				colliding.push(i);
			} else {
				if (DEBUG_DRAW) {
					//DEBUG:
					const r = 0.05;
					this.toDraw.push(pos[0] - r, pos[1] - r, 0,0,1,1);
					this.toDraw.push(pos[0] + r, pos[1] - r, 0,0,1,1);
					this.toDraw.push(pos[0] + r, pos[1] - r, 0,0,1,1);
					this.toDraw.push(pos[0] + r, pos[1] + r, 0,0,1,1);
					this.toDraw.push(pos[0] + r, pos[1] + r, 0,0,1,1);
					this.toDraw.push(pos[0] - r, pos[1] + r, 0,0,1,1);
					this.toDraw.push(pos[0] - r, pos[1] + r, 0,0,1,1);
					this.toDraw.push(pos[0] - r, pos[1] - r, 0,0,1,1);
				}
			}
		}

		for (let iter = 0; iter < 10; ++iter) {
			for (let i of colliding) {
				const prev = this.positions[i];
				const pos = nextPositions[i];
				let isect;
				for (const capsule of this.capsules) {
					let test = capsule.collide(pos);
					if (typeof(test) !== 'undefined') {
						if (typeof(isect) === 'undefined' || isect.depth < test.depth) {
							isect = test;
						}
					}
				}
				if (typeof(isect) !== 'undefined') {
					resolve(prev, pos, isect);
				}
			}
		}


		//body center:
		const body = this.matches[this.matches.length-1];
		const bodyCenter = [0,0];
		for (let v of body.indices) {
			bodyCenter[0] += nextPositions[v][0];
			bodyCenter[1] += nextPositions[v][1];
		}
		bodyCenter[0] /= body.indices.length;
		bodyCenter[1] /= body.indices.length;


		//check targets:
		const oldWon = this.won;
		this.won = true;
		for (const target of this.targets) {
			if (target.collected) {
				target.at[0] = 0.95 * (target.at[0] - bodyCenter[0]) + bodyCenter[0];
				target.at[1] = 0.95 * (target.at[1] - bodyCenter[1]) + bodyCenter[1];
				target.angle += 10.0 * TICK;
				target.fade = Math.max(0, target.fade - TICK / 0.7);
			} else {
				this.won = false;
				target.acc += TICK;
				target.acc -= Math.floor(target.acc);
				target.angle = Math.sin(target.acc * Math.PI * 2.0) * 0.2;

				for (let i = 0; i < nextPositions.length; ++i) {
					const pos = nextPositions[i];
					if (target.check(pos)) {
						target.collected = true;
						this.growToLength += 1;
					}
				}
			}
		}
		if (!oldWon && this.won) {
			console.log("won");
		}


		this.prevPositions = this.positions;
		this.positions = nextPositions;
	}
};

let WORLD = new World({start:[0,0], targets:[], capsules:[]});

class Camera {
	constructor() {
		this.at = [0,2.5];
		this.radius = 10; //square radius
		this.aspect = 1;
	}
	makeWorldToClip() {
		const sx = 2.0 / (2.0 * this.radius * Math.max(1, this.aspect) );
		const sy = 2.0 / (2.0 * this.radius * Math.max(1, 1 / this.aspect) );
		return new Float32Array([
			sx, 0.0, 0.0, 0.0,
			0.0, sy, 0.0, 0.0,
			0.0, 0.0, 1.0, 0.0,
			sx * -this.at[0], sy * -this.at[1], 0.0, 1.0
		]);
	}
	reset(world) {
		if (TEXTURE_CAPTURE_MODE) {
			this.at = [0.5, 0.5];
			this.radius = 0.6;
			return;
		}

		//frame world:
		this.at = [world.start[0], world.start[1]];

		let min = [Infinity, Infinity];
		let max = [-Infinity, -Infinity];

		function expand(x,y,r) {
			if (typeof(r) === 'undefined') r = 0;
			min[0] = Math.min(min[0], x - r);
			min[1] = Math.min(min[1], y - r);
			max[0] = Math.max(max[0], x + r);
			max[1] = Math.max(max[1], y + r);
		}

		expand(world.start[0], world.start[1], 2);
		for (const t of world.targets) {
			expand(t.at[0], t.at[1], TARGET_RAD);
		}

		for (const c of world.capsules) {
			expand(c.a[0], c.a[1], c.r);
			expand(c.b[0], c.b[1], c.r);
		}


		this.at = [(min[0] + max[0])/2, (min[1] + max[1])/2];
		this.radius = 0.5 * Math.max(max[0] - min[0], max[1] - min[1]);

		this.radius = Math.max(this.radius, 7.0);

	}
};

let CAMERA = new Camera();


const TITLE = {
	active:true,
	visible:0,
	acc:Math.random(),
};

//level handling based on amoeba escape:

let maxLevel = 0;
let currentLevel;

function setLevel(idx) {
	if (currentLevel !== idx) {
		if (history && history.replaceState) history.replaceState({},"","?" + idx);
	}
	currentLevel = idx;
	maxLevel = Math.max(maxLevel, currentLevel);
	/*
	if (LEVELS[currentLevel].picture) {
		picture = LEVELS[currentLevel].picture;
		board = null;
		isEnd = (LEVELS[currentLevel].isEnd ? true : false);
	} else {
		picture = null;
	*/
	WORLD = new World(LEVELS[currentLevel]);
	CAMERA.reset(WORLD);

	if (currentLevel === 0) {
		TITLE.active = true;
	} else {
		TITLE.active = false;
	}

	/*
		isEnd = false;
	}
	*/
}

function next() {
	if ((WORLD.won || currentLevel < maxLevel) && currentLevel + 1 < LEVELS.length) {
		setLevel(currentLevel + 1);
	}
}

function prev() {
	if (currentLevel > 0) {
		setLevel(currentLevel - 1);
	}
}

function reset() {
	setLevel(currentLevel);
}

if (document.location.search.match(/^\?\d+/)) {
	setLevel(parseInt(document.location.search.substr(1)));
} else {
	setLevel(0);
}


update.maxPending = 0;

function update(elapsed) {
	elapsed = Math.min(elapsed, 0.1);

	const pending = TEXTURES.pending + AUDIO.pending;
	update.maxPending = Math.max(update.maxPending, pending);
	if (pending > 0) {
		loadDraw(1.0 - (pending / update.maxPending));
		queueUpdate();
		return;
	}

	TITLE.acc += elapsed / 2.4;
	TITLE.acc -= Math.floor(TITLE.acc);
	if (TITLE.active) {
		TITLE.visible = Math.min(1.0, TITLE.visible + elapsed / 1.1);
	} else {
		TITLE.visible = Math.max(0.0, TITLE.visible - elapsed / 0.7);
	}

	WORLD.acc += elapsed;
	while (WORLD.acc > 0.0) {
		WORLD.tick();
		WORLD.acc -= TICK;
	}

	CAMERA.aspect = CANVAS.clientWidth / CANVAS.clientHeight;

	draw();

	queueUpdate();
}

const RECTS = {};

const MISC_BUFFER = gl.createBuffer();

function loadDraw(amount) {
	const C = (0.25 - 0.0) * amount + 1.0;
	gl.clearColor(C,C,C,1);
	gl.clear(gl.COLOR_BUFFER_BIT);
}

function draw() {
	const size = {
		x:parseInt(CANVAS.width),
		y:parseInt(CANVAS.height)
	};
	gl.viewport(0,0,size.x,size.y);

	gl.clearColor(0.25,0.25,0.25,1);
	gl.clear(gl.COLOR_BUFFER_BIT);

	gl.enable(gl.BLEND);
	gl.blendEquation(gl.FUNC_ADD);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);


	const worldToClip = CAMERA.makeWorldToClip();

	{ //draw the sturmun:
		const skinned = [];
		for (let mv of WORLD.meshVertices) {
			let pos = [0,0];
			for (let i = 0; i + 1 < mv.wt.length; i += 2) {
				const src = WORLD.positions[mv.wt[i]];
				pos[0] += mv.wt[i+1] * src[0];
				pos[1] += mv.wt[i+1] * src[1];
			}
			skinned.push(pos[0],pos[1],mv.uv[0],mv.uv[1], 1.0);
		}
		const attribs = [];
		for (const i of WORLD.meshTristrip) {
			attribs.push(...skinned.slice(i*5, i*5+5));
		}

		//ALSO targets:
		for (const target of WORLD.targets) {
			let at = [ target.at[0], target.at[1] ];
			const ang = target.angle;
			let rx = [ Math.cos(ang) * TARGET_RAD, Math.sin(ang) * TARGET_RAD ];
			let ry = [ -rx[1], rx[0] ];

			const uvMin = [0,0.25];
			const uvMax = [0.25,0];

			attribs.push(...attribs.slice(attribs.length-5));
			attribs.push(at[0] - rx[0] - ry[0], at[1] - rx[1] - ry[1],  uvMin[0], uvMin[1], target.fade);
			attribs.push(...attribs.slice(attribs.length-5));

			attribs.push(at[0] - rx[0] + ry[0], at[1] - rx[1] + ry[1],  uvMin[0], uvMax[1], target.fade);
			attribs.push(at[0] + rx[0] - ry[0], at[1] + rx[1] - ry[1],  uvMax[0], uvMin[1], target.fade);
			attribs.push(at[0] + rx[0] + ry[0], at[1] + rx[1] + ry[1],  uvMax[0], uvMax[1], target.fade);
		}




		const u = {
			uObjectToClip:worldToClip,
			uTex:new Uint32Array([0]),
		};
		const prog = SHADERS.texture;
		gl.useProgram(prog);

		setUniforms(prog, u);

		//upload and draw attribs:
		gl.bindBuffer(gl.ARRAY_BUFFER, MISC_BUFFER);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(attribs), gl.STREAM_DRAW);


		const stride = 2*4+3*4;
		//0 => Position
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
		//1 => Normal
		gl.disableVertexAttribArray(1);
		gl.vertexAttrib3f(1, 0.0, 0.0, 1.0);
		//gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3*4);
		//2 => Color
		gl.disableVertexAttribArray(2);
		gl.vertexAttrib4f(2, 1.0, 1.0, 1.0, 1.0);
		//gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 2*4);
		//3 => TexCoord
		gl.enableVertexAttribArray(3);
		gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 2*4);

		gl.bindTexture(gl.TEXTURE_2D, TEXTURES.mun);


		gl.drawArrays(gl.TRIANGLE_STRIP, 0, attribs.length/(stride/4));

		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	{ //some test drawing stuff:
		let attribs = [...WORLD.toDraw];

		//capsules
		for (const capsule of WORLD.capsules) {
			{
				const C = [0.6,0.6,0.6,1];
				attribs.push(...capsule.a, ...C);
				attribs.push(...capsule.b, ...C);
			}
			{
				const C = [1,1,1,1];
				let prev = [
					capsule.b[0] + capsule.perp[0] * capsule.r,
					capsule.b[1] + capsule.perp[1] * capsule.r
				];
				for (let a = 0; a <= 10; ++a) {
					const ang = (a / 10 - 1.5) * Math.PI;
					const c = Math.cos(ang) * capsule.r;
					const s = Math.sin(ang) * capsule.r;
					let pt = [
						capsule.a[0] + c * capsule.along[0] + s * capsule.perp[0],
						capsule.a[1] + c * capsule.along[1] + s * capsule.perp[1]
					];
					attribs.push(...prev, ...C);
					attribs.push(...pt, ...C);
					prev = pt;
				}
				for (let a = 0; a <= 10; ++a) {
					const ang = (a / 10 - 0.5) * Math.PI;
					const c = Math.cos(ang) * capsule.r;
					const s = Math.sin(ang) * capsule.r;
					let pt = [
						capsule.b[0] + c * capsule.along[0] + s * capsule.perp[0],
						capsule.b[1] + c * capsule.along[1] + s * capsule.perp[1]
					];
					attribs.push(...prev, ...C);
					attribs.push(...pt, ...C);
					prev = pt;
				}
			}
		}

		//targets
		if (DEBUG_DRAW)
		for (const target of WORLD.targets) {
			const C = [1.0,1.0,0.2,1];
			let prev = [ target.at[0] + TARGET_RAD, target.at[1] ];
			for (let a = 1; a <= 20; ++a) {
				const ang = a / 20 * 2.0 * Math.PI;
				let pt = [
					target.at[0] + Math.cos(ang) * TARGET_RAD,
					target.at[1] + Math.sin(ang) * TARGET_RAD
				];
				attribs.push(...prev, ...C);
				attribs.push(...pt, ...C);
				prev = pt;
			}
		}


		if (DEBUG_DRAW)
		{ //limb length targets
			const c = [
				CAMERA.at[0] - CAMERA.radius * CAMERA.aspect + 0.1 * CAMERA.radius,
				CAMERA.at[1] + CAMERA.radius - 0.1 * CAMERA.radius
			];
			const G = 0.1 * CAMERA.radius;
			const C = [1,0,0.5,1];
			for (let l = 0; l < WORLD.limbs.length; ++l) {
				attribs.push(c[0] + l * G, c[1], ...C);
				attribs.push(c[0] + l * G, c[1] - WORLD.limbs[l].length, ...C);
			}
		}

		if (DEBUG_DRAW)
		{
			const R = 0.1;
			const C = [1,1,1,1];
			for (let pos of WORLD.positions) {
				attribs.push(pos[0] - R, pos[1] - R, ...C);
				attribs.push(pos[0] + R, pos[1] + R, ...C);
				attribs.push(pos[0] - R, pos[1] + R, ...C);
				attribs.push(pos[0] + R, pos[1] - R, ...C);
			}
		}

		if (DEBUG_DRAW)
		{
			const R = 0.1;
			const C = [0.5,0.5,0.5,1];
			for (const match of WORLD.matches) {
				for (let i = 0; i < match.indices.length; ++i) {
					let a = match.indices[i];
					let b = match.indices[(i+1)%match.indices.length];
					attribs.push(...WORLD.positions[a], ...C);
					attribs.push(...WORLD.positions[b], ...C);
				}
			}
		}



		const u = {
			uObjectToClip:worldToClip,
		};
		const prog = SHADERS.color;
		gl.useProgram(prog);

		setUniforms(prog, u);

		//upload and draw attribs:
		gl.bindBuffer(gl.ARRAY_BUFFER, MISC_BUFFER);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(attribs), gl.STREAM_DRAW);

		const stride = 2*4+4*4;
		//0 => Position
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
		//1 => Normal
		gl.disableVertexAttribArray(1);
		gl.vertexAttrib3f(1, 0.0, 0.0, 1.0);
		//gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3*4);
		//2 => Color
		gl.enableVertexAttribArray(2);
		gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 2*4);
		//3 => TexCoord
		gl.disableVertexAttribArray(3);
		gl.vertexAttrib2f(3, 0.0, 0.0);
		//gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 3*4+3*4+4*1);

		gl.drawArrays(gl.LINES, 0, attribs.length/(stride/4));
	}


	{ //Overlays:
		const aspect = CAMERA.aspect;
		const sx = Math.min(1.0 / aspect, 1.0);
		const sy = Math.min(1.0, aspect);
		const rx = 1.0 / sx;
		const ry = 1.0 / sy;

		const attribs = [];

		function rect(minPX,sizePX, width, anchor, anchorAt, name) {

			const minUV = [minPX[0] / 1024.0, (minPX[1] + sizePX[1]) / 1024.0];
			const maxUV = [(minPX[0] + sizePX[0]) / 1024.0, minPX[1] / 1024.0];

			const size = [
				width,
				width * sizePX[1] / sizePX[0]
			];

			const rel = [size[0] * anchor[0], size[1] * anchor[1]];

			const min = [anchorAt[0] - rel[0], anchorAt[1] - rel[1]];
			const max = [min[0] + size[0], min[1] + size[1]];

			//store in clip coords (where mouse is also stored):
			RECTS[name] = {
				min:[min[0] * sx * 0.5 + 0.5, min[1] * sy * 0.5 + 0.5],
				max:[max[0] * sx * 0.5 + 0.5, max[1] * sy * 0.5 + 0.5]
			};


			const dup = (attribs.length !== 0);
			if (dup) attribs.push(...attribs.slice(attribs.length-5));
			attribs.push(min[0], min[1], minUV[0], minUV[1], 1.0);
			if (dup) attribs.push(...attribs.slice(attribs.length-5));
			attribs.push(min[0], max[1], minUV[0], maxUV[1], 1.0);
			attribs.push(max[0], min[1], maxUV[0], minUV[1], 1.0);
			attribs.push(max[0], max[1], maxUV[0], maxUV[1], 1.0);
		}

		const M = 0.04;

		delete RECTS["reset"];
		delete RECTS["next"];

		//reset:
		rect([537,0], [485,132], 0.6, [0,1], [-rx+M,ry-M], "reset");


		//mute:
		rect([586,150], [134,123], 0.6 * (134/485), [1, 1], [rx-0.5*M, ry-0.5*M],"mute");
		if (AUDIO.muted) {
			rect([752,150], [135,123], 0.6 * (134/485), [1, 1], [rx-0.5*M, ry-0.5*M]);
		}

		if ((WORLD.won && currentLevel + 1 < LEVELS.length) || currentLevel < maxLevel) {
			//next:
			rect([0,0], [522,131], 0.6, [1,0], [rx-M,-ry+M], "next");
		}

		if (currentLevel > 0) {
			rect([6,140], [509,132], 0.6 * (509/522), [0,0], [-rx+M,-ry+M], "prev");
		}

		if (TITLE.visible > 0) { //title:
			const ang = TITLE.acc * Math.PI * 2;
			let d = [Math.cos(ang * 3) * 0.01, Math.sin(ang * 5) * 0.005];
			d[1] += 1.0 * (1 - TITLE.visible ** 0.5);

			rect([68,408], [778,235], 2.0, [0.5,0], [0 + d[0],0.2 + d[1]]);
			d = [0,0];
			d[1] += 1.0 * (1 - TITLE.visible ** 0.5);
			rect([687,355], [146,41], 2.0 * (146/778), [0.5,0.5], [0.50+d[0],0.52+0.2+d[1]]);

			d[0] += Math.cos(ang * 2) * 0.005;
			d[1] += Math.sin(ang * 4) * 0.005;
			rect([247,650], [438,55], 2.0 * (438/778), [0.5,0.5], [0.0+d[0],0.05+0.2+d[1]]);
		}

		if (currentLevel + 1 == LEVELS.length) {
			const ang = TITLE.acc * Math.PI * 2;
			let d = [Math.cos(ang * 3) * 0.01, Math.sin(ang * 5) * 0.005];

			//"dance"
			rect([64,734], [422,217], 1.3, [0.5,0], [0 + d[0],0.3 + d[1]]);
			d = [0,0];
			//"[dance!]"
			rect([64,673], [116,42], 1.3 * (116/422), [0.5, 0.5], [0.20, 0.77]);

			d[0] += Math.cos(ang * 2) * 0.005;
			d[1] += Math.sin(ang * 4) * 0.005;

			rect([165,956], [161,32], 1.3 * (161/422), [0.5, 0.5], [0.0+d[0], 0.4+d[1]]);
		}

		if (currentLevel == 0 || currentLevel + 1 == LEVELS.length) {
			//TCHOW info:
			rect([848,510], [136,82], 0.4, [0.5, 0], [0.0, -ry+0.5*M],"tchow");
		}


		if (currentLevel == 1) {
			rect([730,697], [224,173], 0.7, [0, 0.7], [-rx+M, 0]);
			rect([550,711], [133,140], 0.7 * (133 / 244), [1, 0.7], [rx-M, 0]);
		}

		window.DEBUG = {rx, ry};

		const u = {
			uObjectToClip:new Float32Array([
				sx, 0.0, 0.0, 0.0,
				0.0, sy, 0.0, 0.0,
				0.0, 0.0, 1.0, 0.0,
				0.0, 0.0, 0.0, 1.0
			]),
			uTex:new Uint32Array([0]),
		};

		const prog = SHADERS.texture;
		gl.useProgram(prog);

		setUniforms(prog, u);

		//upload and draw attribs:
		gl.bindBuffer(gl.ARRAY_BUFFER, MISC_BUFFER);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(attribs), gl.STREAM_DRAW);


		const stride = 2*4+3*4;
		//0 => Position
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
		//1 => Normal
		gl.disableVertexAttribArray(1);
		gl.vertexAttrib3f(1, 0.0, 0.0, 1.0);
		//gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3*4);
		//2 => Color
		gl.disableVertexAttribArray(2);
		gl.vertexAttrib4f(2, 1.0, 1.0, 1.0, 1.0);
		//gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 2*4);
		//3 => TexCoord
		gl.enableVertexAttribArray(3);
		gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 2*4);

		gl.bindTexture(gl.TEXTURE_2D, TEXTURES.text);


		gl.drawArrays(gl.TRIANGLE_STRIP, 0, attribs.length/(stride/4));

		gl.bindTexture(gl.TEXTURE_2D, null);
	}

}


function resized() {
	const size = {x:CANVAS.clientWidth, y:CANVAS.clientHeight};
	CANVAS.width = Math.round(size.x * window.devicePixelRatio);
	CANVAS.height = Math.round(size.y * window.devicePixelRatio);
	queueUpdate();
}

window.addEventListener('resize', resized);
resized();

function queueUpdate() {
	if (queueUpdate.queued) return;
	queueUpdate.queued = true;
	window.requestAnimationFrame(function(timestamp){
		delete queueUpdate.queued;
		if (!('prevTimestamp' in queueUpdate)) {
			queueUpdate.prevTimestamp = timestamp;
		}
		const delta = (timestamp - queueUpdate.prevTimestamp);
		update(delta / 1000.0);
		queueUpdate.prevTimestamp = timestamp;
	});
}

queueUpdate();

function keydown(evt) {
	if (evt.repeat) /* nothing */;
	else if (evt.code === 'KeyE') WORLD.limbs[0].grow = true;
	else if (evt.code === 'KeyW') WORLD.limbs[1].grow = true;
	else if (evt.code === 'KeyQ') WORLD.limbs[2].grow = true;
	else if (evt.code === 'KeyA') WORLD.limbs[3].grow = true;
	else if (evt.code === 'KeyD') WORLD.limbs[4].grow = true;
	else if (evt.code === 'KeyN') next();
	else if (evt.code === 'KeyP') prev();
	else if (evt.code === 'KeyR') reset();
}

function keyup(evt) {
	if      (evt.code === 'KeyE') WORLD.limbs[0].grow = false;
	else if (evt.code === 'KeyW') WORLD.limbs[1].grow = false;
	else if (evt.code === 'KeyQ') WORLD.limbs[2].grow = false;
	else if (evt.code === 'KeyA') WORLD.limbs[3].grow = false;
	else if (evt.code === 'KeyD') WORLD.limbs[4].grow = false;
}

window.addEventListener('keydown', keydown);
window.addEventListener('keyup', keyup);

const MOUSE = {x:NaN, y:NaN};

//based (loosely) on amoeba-escape's mouse handling:
function setMouse(evt) {
	var rect = CANVAS.getBoundingClientRect();
	MOUSE.x = (evt.clientX - rect.left) / rect.width;
	MOUSE.y = (evt.clientY - rect.bottom) / -rect.height;

	function inRect(name) {
		return name in RECTS && (
			RECTS[name].min[0] <= MOUSE.x && MOUSE.x <= RECTS[name].max[0]
			&& RECTS[name].min[1] <= MOUSE.y && MOUSE.y <= RECTS[name].max[1]
		);
	}

	MOUSE.overReset = inRect("reset");
	MOUSE.overNext = inRect("next");
	MOUSE.overPrev = inRect("prev");
	MOUSE.overTCHOW = inRect("tchow");
	MOUSE.overMute = inRect("mute");
}

function handleDown() {
	if (MOUSE.overReset) {
		reset();
	} else if (MOUSE.overUndo) {
		undo();
	} else if (MOUSE.overNext) {
		next();
	} else if (MOUSE.overPrev) {
		prev();
	} else if (MOUSE.overTCHOW) {
		window.open('http://tchow.com', '_blank').focus();
	} else if (MOUSE.overMute) {
		AUDIO.mute();
	}
}

function handleUp() {
}

CANVAS.addEventListener('touchstart', function(evt){
	evt.preventDefault();
	setMouse(evt.touches[0]);
	handleDown(evt.touches[0]);
	return false;
});
CANVAS.addEventListener('touchmove', function(evt){
	evt.preventDefault();
	setMouse(evt.touches[0]);
	return false;
});
CANVAS.addEventListener('touchend', function(evt){
	handleUp();
	mouse.x = NaN;
	mouse.y = NaN;
	return false;
});

window.addEventListener('mousemove', function(evt){
	evt.preventDefault();
	setMouse(evt);
	return false;
});
window.addEventListener('mousedown', function(evt){
	evt.preventDefault();
	setMouse(evt);
	handleDown(evt);
	return false;
});

window.addEventListener('mouseup', function(evt){
	evt.preventDefault();
	setMouse(evt);
	handleUp();
	return false;
});


