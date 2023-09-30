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

const TICK = 1.0 / 120.0;

class Match {
	constructor(indices, targets, limb) {
		this.indices = indices.slice();
		this.targets = targets.slice();
		this.limb = limb;
		this.xScale = 1.0;
		this.weight = 1.0;
		let acc = [0,0];
		for (const t of targets) {
			acc[0] += t[0];
			acc[1] += t[1];
		}
		acc[0] /= targets.length;
		acc[1] /= targets.length;
		for (const t of targets) {
			t[0] -= acc[0];
			t[1] -= acc[1];
		}
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

	collide(p0, p1) {
		//ray vs capsule (2d), returns description of earliest collision time

		//track earliest intersection time and amount along the line:
		let t = 2.0;
		let pt = 0.0;

		//handle segment:
		const along0 = (p0[0] - this.a[0]) * this.along[0] + (p0[1] - this.a[1]) * this.along[1];
		const perp0 = (p0[0] - this.a[0]) * this.perp[0] + (p0[1] - this.a[1]) * this.perp[1];

		if (along0 >= 0 && along0 <= this.length && Math.abs(perp0) < this.r) {
			t = 0.0;
			pt = along0 / this.length;
		} else {
			const along1 = (p1[0] - this.a[0]) * this.along[0] + (p1[1] - this.a[1]) * this.along[1];
			const perp1 = (p1[0] - this.a[0]) * this.perp[0] + (p1[1] - this.a[1]) * this.perp[1];

			if (perp0 >= this.r && perp1 < this.r) {
				let tr = (this.r - perp0) / (perp1 - perp0);

				let a = (along1 - along0) * tr + along0;

				if (a >= 0 && a <= this.length) {
					t = tr;
					pt = a / this.length;
				}
			} else if (perp0 < -this.r && perp1 > -this.r) {
				let tr = (-this.r - perp0) / (perp1 - perp0);

				let a = (along1 - along0) * tr + along0;

				if (a >= 0 && a <= this.length) {
					t = tr;
					pt = a / this.length;
				}
			}
		}


		//endpoints:
		function vs_circle(center, radius) {
			//(t * (p1 - p0) + p0 - a) ^ 2 = r

			const qc = (p0[0] - center[0]) ** 2 + (p0[1] - center[1]) ** 2 - radius ** 2;

			//intersects at t = 0:
			if (qc < 0) return 0.0;

			const qa = (p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2;
			const qb = 2 * ( (p1[0] - p0[0]) * (p0[0] - center[0]) + (p1[1] - p0[1]) * (p0[1] - center[1]) );

			const d = qb ** 2 - 4 * qa * qc;

			//never intersects:
			if (d < 0) return 2.0;

			const t0 = (-qb - Math.sqrt(d)) / (2 * qa);
			const t1 = (-qb + Math.sqrt(d)) / (2 * qa);

			//this could be cleaner, I think. Only case that matters is t0 >= 0, <= 1 probably
			if (t0 >= 0.0 && t0 <= 1.0) return t0;
			if (t1 >= 0.0 && t1 <= 1.0) return t1;

			//no intersection in time range:
			return 2.0;
		}

		{
			const ta = vs_circle(this.a, this.r);
			if (ta < t) {
				t = ta;
				pt = 0.0;
			}
		}
		{
			const tb = vs_circle(this.b, this.r);
			if (tb < t) {
				t = tb;
				pt = 1.0;
			}
		}

		if (t >= 0.0 && t <= 1.0) {
			const close = [
				pt * (this.b[0] - this.a[0]) + this.a[0],
				pt * (this.b[1] - this.a[1]) + this.a[1],
			];
			const interp = [
				t * (p1[0] - p0[0]) + p0[0],
				t * (p1[1] - p0[1]) + p0[1]
			];
			const out = [
				interp[0] - close[0],
				interp[1] - close[1]
			];
			return {
				t:t,
				at:interp,
				out:out,
			};
		}

	}
}

const TARGET_RAD = 0.7;

class Target {
	constructor(at) {
		this.at = at;
	}
	check(p) {
		const dis2 = (p[0] - this.at[0]) ** 2 + (p[1] - this.at[1]) ** 2;
		return dis2 < TARGET_RAD ** 2;
	}
}

const LIMB_SEGS = 5;

class World {
	constructor() {
		this.acc = 0.0;
		this.positions = [];
		this.prevPositions = [];
		this.matches = [];

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

		const buildLimb = (limb, angle) => {
			const SEGS = LIMB_SEGS;
			const along = [Math.cos(angle), Math.sin(angle)];
			const perp = [-along[1], along[0]];

			const S = 0.9; //start
			const W = 1.0; //segment width (unscaled)
			const w = (0.5 + limb.length) / SEGS;
			const R = 0.5; //radius

			let v0 = this.positions.length;
			this.positions.push([S * along[0] - R * perp[0], S * along[1] - R * perp[1]]);
			let v1 = this.positions.length;
			this.positions.push([S * along[0] + R * perp[0], S * along[1] + R * perp[1]]);

			for (let seg = 0; seg < SEGS; ++seg) {
				const s = S + w * (seg+1);
				let n0 = this.positions.length;
				this.positions.push([s * along[0] - R * perp[0], s * along[1] - R * perp[1]]);
				let n1 = this.positions.length;
				this.positions.push([s * along[0] + R * perp[0], s * along[1] + R * perp[1]]);

				let indices = [v0, n0, n1, v1];
				let targets = [ [0, -R], [W,-R], [W, R], [0, R] ];

				this.matches.push(new Match(indices, targets, limb));

				v0 = n0;
				v1 = n1;
			}

			{ //the tip:
				const s = S + w * SEGS + W;
				let vE = this.positions.length;
				this.positions.push([s * along[0], s * along[1]]);

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

		this.prevPositions = this.positions.slice();


		this.capsules = [];

		this.capsules.push(new Capsule(2.0, [-15,0], [-10,-2]) );
		this.capsules.push(new Capsule(2.0, [-10,-3], [5,-3]) );
		this.capsules.push(new Capsule(2.0, [5,-3], [10,0]) );

		this.targets = [];

		this.targets.push(new Target([-5, 5]));
		this.targets.push(new Target([ 5, 0]));
	}
	tick() {

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
		for (const capsule of this.capsules) {
			for (let i = 0; i < nextPositions.length; ++i) {
				const prev = this.positions[i];
				const pos = nextPositions[i];
				const isect = capsule.collide(prev, pos);
				if (typeof(isect) !== 'undefined') {
					const invLength = 1.0 / Math.sqrt(isect.out[0] ** 2 + isect.out[1] ** 2);
					const out = [isect.out[0] * invLength, isect.out[1] * invLength];
					const perp = [-out[1], out[0]];
					let vo = (pos[0] - prev[0]) * out[0] + (pos[1] - prev[1]) * out[1];
					let vp = (pos[0] - prev[0]) * perp[0] + (pos[1] - prev[1]) * perp[1];

					if (vo < 0.0) {
						const friction = 0.5 * Math.abs(vo);
						vo = COEF * -vo;

						if (vp > 0) vp = Math.max(0, vp - friction);
						else vp = Math.min(0, vp + friction);
						//vp = 0.9 * vp; //"friction"

						const ofs = (isect.at[0] - pos[0]) * out[0] + (isect.at[1] - pos[1]) * out[1];

						pos[0] += ofs * out[0];
						pos[1] += ofs * out[1];

						//pos[0] = isect.at[0];
						//pos[1] = isect.at[1];
					}


					prev[0] = pos[0] - (vo * out[0] + vp * perp[0]);
					prev[1] = pos[1] - (vo * out[1] + vp * perp[1]);
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
		for (const target of this.targets) {
			if (target.collected) {
				target.at[0] = 0.95 * (target.at[0] - bodyCenter[0]) + bodyCenter[0];
				target.at[1] = 0.95 * (target.at[1] - bodyCenter[1]) + bodyCenter[1];
			} else {
				for (let i = 0; i < nextPositions.length; ++i) {
					const pos = nextPositions[i];
					if (target.check(pos)) {
						target.collected = true;
						this.growToLength += 1;
					}
				}
			}
		}


		this.prevPositions = this.positions;
		this.positions = nextPositions;
	}
};

let WORLD = new World();

class Camera {
	constructor() {
		this.at = [0,2.5];
		this.radius = 10; //vertical radius
		this.aspect = 1;
	}
	makeWorldToClip() {
		const sx = 2.0 / (2.0 * this.radius * this.aspect);
		const sy = 2.0 / (2.0 * this.radius);
		return new Float32Array([
			sx, 0.0, 0.0, 0.0,
			0.0, sy, 0.0, 0.0,
			0.0, 0.0, 1.0, 0.0,
			sx * -this.at[0], sy * -this.at[1], 0.0, 1.0
		]);
	}
};

let CAMERA = new Camera();

function update(elapsed) {
	elapsed = Math.min(elapsed, 0.1);

	WORLD.acc += elapsed;
	while (WORLD.acc > 0.0) {
		WORLD.tick();
		WORLD.acc -= TICK;
	}

	CAMERA.aspect = CANVAS.clientWidth / CANVAS.clientHeight;

	draw();

	queueUpdate();
}

const MISC_BUFFER = gl.createBuffer();

function draw() {
	const size = {
		x:parseInt(CANVAS.width),
		y:parseInt(CANVAS.height)
	};
	gl.viewport(0,0,size.x,size.y);

	gl.clearColor(0.25,0.25,0.25,1);
	gl.clear(gl.COLOR_BUFFER_BIT);


	const worldToClip = CAMERA.makeWorldToClip();
	/*new Float32Array([
		1.0, 0.0, 0.0, 0.0,
		0.0, 1.0, 0.0, 0.0,
		0.0, 0.0, 1.0, 0.0,
		0.0, 0.0, 0.0, 1.0
	]);*/

	{ //some test drawing stuff:
		let attribs = [];

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

		//upload and draw arrow attribs:
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
