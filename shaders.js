"use strict";

const SHADERS = {
};

SHADERS.load = function SHADERS_load() {
	SHADERS.color = initShaderProgram(gl,`
		attribute vec4 aPosition;
		attribute vec4 aColor;
		uniform mat4 uObjectToClip;
		varying vec4 vColor;
		void main() {
			gl_Position = uObjectToClip * aPosition;
			vColor = aColor;
		}
	`,`
		varying lowp vec4 vColor;
		void main() {
			gl_FragColor = vColor;
		}
	`);
	SHADERS.solid = initShaderProgram(gl,`
		attribute vec4 aPosition;
		attribute vec3 aNormal;
		attribute vec4 aColor;
		uniform mat4 uObjectToClip;
		uniform mat4 uObjectToLight;
		uniform mat3 uNormalToLight;
		varying vec3 vPosition;
		varying vec3 vNormal;
		varying vec4 vColor;
		void main() {
			gl_Position = uObjectToClip * aPosition;
			vPosition = vec3(uObjectToLight * aPosition);
			vNormal = uNormalToLight * aNormal;
			vColor = aColor;
		}
	`,`
		uniform lowp vec4 uTint;
		uniform lowp float uSaturate;

		uniform highp vec3 uToSun;
		uniform mediump vec3 uSunEnergy;
		uniform mediump vec3 uSkyEnergy;

		varying highp vec3 vPosition;
		varying mediump vec3 vNormal;
		varying lowp vec4 vColor;
		void main() {
			mediump vec3 albedo = mix(vColor.rgb, uTint.rgb, uTint.a);
			//TODO: texture
			albedo = mix(vec3(max(max(albedo.r,albedo.g),albedo.b)), albedo, uSaturate);
			mediump vec3 n = normalize(vNormal);
			mediump vec3 e =
				uSkyEnergy * (dot(n,vec3(0.0,0.0,1.0))*0.5 + 0.5)
				+ uSunEnergy * max(dot(n,uToSun), 0.0)
			;
			gl_FragColor = vec4(e*albedo, vColor.a);
			//gl_FragColor = vec4(vNormal * 0.5 + 0.5, 1.0);
		}
	`);
	SHADERS.shadow = initShaderProgram(gl,`
		attribute vec4 aPosition;
		attribute vec3 aNormal;
		attribute vec4 aColor;
		uniform mat4 uLightToClip;
		uniform mat4 uObjectToLight;
		uniform mat3 uNormalToLight;
		uniform vec3 uToSun;
		varying vec4 vColor;
		void main() {
			vec4 position = vec4((uObjectToLight * aPosition).xyz, 1.0);
			vec3 normal = uNormalToLight * aNormal;
			vec3 toLight = vec3(-0.2, 0.2, 0.7);
			if (dot(normal, uToSun) > 0.0) {
				//position = vec4(-toLight, 0.0);
				position += 2.0 * vec4(-uToSun, 0.0); //HACK: shorten to save some fill
			}
			gl_Position = uLightToClip * position;
			vColor = vec4(normal * 0.5 + 0.5, 1.0);
		}
	`,`
		varying lowp vec4 vColor;
		void main() {
			gl_FragColor = vColor;
		}
	`);

};
