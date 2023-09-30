

//Helper functions from MDN webgl tutorial:
// https://github.com/mdn/webgl-examples/blob/gh-pages/tutorial/sample2/webgl-demo.js

//
// Initialize a shader program, so WebGL knows how to draw our data
//
function initShaderProgram(gl, vsSource, fsSource) {
	const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
	const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

	// Create the shader program

	const shaderProgram = gl.createProgram();
	gl.attachShader(shaderProgram, vertexShader);
	gl.attachShader(shaderProgram, fragmentShader);

	gl.bindAttribLocation(shaderProgram, 0, "aPosition");
	gl.bindAttribLocation(shaderProgram, 1, "aNormal");
	gl.bindAttribLocation(shaderProgram, 2, "aColor");
	gl.bindAttribLocation(shaderProgram, 3, "aTexCoord");

	gl.linkProgram(shaderProgram);

	// If creating the shader program failed, alert

	if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
		throw new Error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
		return null;
	}

	//from 15-466-f18's notes:
	//  http://graphics.cs.cmu.edu/courses/15-466-f18/notes/gl-helpers.js

	//store information about program attributes:
	var na = gl.getProgramParameter(shaderProgram, gl.ACTIVE_ATTRIBUTES);
	for (var i = 0; i < na; ++i) {
		var a = gl.getActiveAttrib(shaderProgram, i);
		shaderProgram[a.name] = {
			location:gl.getAttribLocation(shaderProgram, a.name),
			type:a.type,
			size:a.size
		};
	}

	//store information about program uniforms:
	var nu = gl.getProgramParameter(shaderProgram, gl.ACTIVE_UNIFORMS);
	for (var i = 0; i < nu; ++i) {
		var u = gl.getActiveUniform(shaderProgram, i);
		shaderProgram[u.name] = {
			location:gl.getUniformLocation(shaderProgram, u.name),
			type:u.type,
			size:u.size
		};
	}

	return shaderProgram;
}


//
// creates a shader of the given type, uploads the source and
// compiles it.
//
function loadShader(gl, type, source) {
	const shader = gl.createShader(type);

	// Send the source to the shader object

	gl.shaderSource(shader, source);

	// Compile the shader program

	gl.compileShader(shader);

	// See if it compiled successfully

	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		throw new Error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
		gl.deleteShader(shader);
		return null;
	}

	return shader;
}

function setUniforms(program, uniforms) {
	gl.useProgram(program);

	var warned = setUniforms.warned || (setUniforms.warned = {});
	for (var name in uniforms) {
		//warn about unused uniforms:
		if (!(name in program)) {
			if (!(name in warned)) {
				console.warn("Uniform '" + name + "' specified, but not used in shaders.");
				warned[name] = true;
			}
		}
	}

	var nu = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
	for (var i = 0; i < nu; ++i) {
		var u = gl.getActiveUniform(program, i);
		var loc = gl.getUniformLocation(program, u.name);

		if (!(u.name in uniforms)) {
			//error if not specified:
			throw new Error("Uniform '" + u.name + "' used in shaders but not specified.");
		}
		var value = uniforms[u.name];
		if (u.type === gl.FLOAT) {
			if (value.length !== 1) {
				throw new Error("Uniform '" + u.name + "' is a float, but value given is of length " + value.length);
			}
			gl.uniform1fv(loc, value);
		} else if (u.type === gl.FLOAT_VEC2) {
			if (value.length !== 2) {
				throw new Error("Uniform '" + u.name + "' is a vec2, but value given is of length " + value.length);
			}
			gl.uniform2fv(loc, value);
		} else if (u.type === gl.FLOAT_VEC3) {
			if (value.length !== 3) {
				throw new Error("Uniform '" + u.name + "' is a vec3, but value given is of length " + value.length);
			}
			gl.uniform3fv(loc, value);
		} else if (u.type === gl.FLOAT_VEC4) {
			if (value.length !== 4) {
				throw new Error("Uniform '" + u.name + "' is a vec4, but value given is of length " + value.length);
			}
			gl.uniform4fv(loc, value);
		} else if (u.type === gl.INT) {
			if (value.length !== 1) {
				throw new Error("Uniform '" + u.name + "' is a int, but value given is of length " + value.length);
			}
			gl.uniform1iv(loc, value);
		} else if (u.type === gl.INT_VEC2) {
			if (value.length !== 2) {
				throw new Error("Uniform '" + u.name + "' is a ivec2, but value given is of length " + value.length);
			}
			gl.uniform2iv(loc, value);
		} else if (u.type === gl.INT_VEC3) {
			if (value.length !== 3) {
				throw new Error("Uniform '" + u.name + "' is a ivec3, but value given is of length " + value.length);
			}
			gl.uniform3iv(loc, value);
		} else if (u.type === gl.INT_VEC4) {
			if (value.length !== 4) {
				throw new Error("Uniform '" + u.name + "' is a ivec4, but value given is of length " + value.length);
			}
			gl.uniform4iv(loc, value);
		} else if (u.type === gl.FLOAT_MAT2) {
			if (value.length !== 2*2) {
				throw new Error("Uniform '" + u.name + "' is a mat2, but value given is of length " + value.length);
			}
			gl.uniformMatrix2fv(loc, false, value);
		} else if (u.type === gl.FLOAT_MAT3) {
			if (value.length !== 3*3) {
				throw new Error("Uniform '" + u.name + "' is a mat3, but value given is of length " + value.length);
			}
			gl.uniformMatrix3fv(loc, false, value);
		} else if (u.type === gl.FLOAT_MAT4) {
			if (value.length !== 4*4) {
				throw new Error("Uniform '" + u.name + "' is a mat4, but value given is of length " + value.length);
			}
			gl.uniformMatrix4fv(loc, false, value);
		} else if (u.type === gl.SAMPLER_2D) {
			if (value.length !== 1) {
				throw new Error("Uniform '" + u.name + "' is a sampler2D, but value given is of length " + value.length);
			}
			gl.uniform1iv(loc, value);

		} else {
			throw new Error("Uniform '" + u.name + "' has a type '" + u.type + "' not supported by this code.");
		}
	}
}

