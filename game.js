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

const TICK = 0.01;

class Match {
	constructor(indices, targets) {
		this.indices = indices.slice();
		this.targets = targets.slice();
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

		//no rotation -- just translate target to avg:
		return [
			1,0,
			0,1,
			avg[0], avg[1]
		];

	}
}

class World {
	constructor() {
		this.acc = 0.0;
		this.positions = [];
		this.prevPositions = [];
		this.matches = [];

		this.positions.push([0,0]);
		this.positions.push([0,1]);
		this.positions.push([1,0]);
		this.positions.push([1,1]);
		this.positions.push([2,0]);
		this.positions.push([2,1]);
		this.positions.push([3,0.5]);

		const addMatch = (...indices) => {
			let targets = [];
			for (let v of indices) {
				targets.push(this.positions[v].slice());
			}
			this.matches.push(new Match(indices, targets));
		}

		for (let b = 0; b <= 2; b += 2) {
			addMatch(b+0,b+1,b+3,b+2);
			/*
			addMatch(b+0,b+2,b+3);
			addMatch(b+0,b+3,b+1);

			addMatch(b+1,b+0,b+2);
			addMatch(b+1,b+2,b+3);
			*/
		}
		addMatch(4,6,5);

		this.prevPositions = this.positions.slice();
	}
	tick() {

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

		{ //vs shape matching:
			const targets = [];
			for (let i = 0; i < nextPositions.length; ++i) {
				targets.push([0,0,0]); //accumulators, last is weight
			}
			for (const match of this.matches) {
				const xf = match.fit(nextPositions);
				for (let i = 0; i < match.indices.length; ++i) {
					const v = match.indices[i];
					const t = match.targets[i];
					targets[v][0] += xf[0] * t[0] + xf[2] * t[1] + xf[4];
					targets[v][1] += xf[1] * t[0] + xf[3] * t[1] + xf[5];
					targets[v][2] += 1;
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
		const GROUND = -1.0;
		for (let i = 0; i < nextPositions.length; ++i) {
			const prev = this.positions[i];
			const pos = nextPositions[i];
			if (pos[1] < GROUND) {
				if (prev[1] > pos[1]) {
					prev[1] = GROUND + COEF * (pos[1] - prev[1]);
				}
				pos[1] = GROUND;
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
		this.radius = 5; //vertical radius
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
		attribs.push(-1,-1, 1,0,0,1);
		attribs.push(1,1, 1,0,0,1);
		attribs.push(-1,1, 1,0,0,1);
		attribs.push(1,-1, 1,0,0,1);

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
