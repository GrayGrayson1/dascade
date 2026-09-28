/**
 * Small, composable onBeforeCompile patches for world materials (Lambert). Each patch chains any
 * patch already installed, so several can stack on one material.
 */
import type { MeshLambertMaterial, WebGLProgramParametersWithUniforms } from 'three';

function chain(m: MeshLambertMaterial, key: string, patch: (sh: WebGLProgramParametersWithUniforms) => void): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey?.() ?? '';
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    patch(sh);
  };
  m.customProgramCacheKey = () => `${prevKey}|${key}`;
}

/** World position varying (shared by the patches below; idempotent). */
function ensureWorldPos(sh: WebGLProgramParametersWithUniforms): void {
  if (sh.vertexShader.includes('vPatchWPos')) return;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vPatchWPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPatchWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPatchWPos;');
}

/**
 * Snow / ice glints: sparse view-dependent pixel sparkles that twinkle as the camera moves
 * (pure emissive; fades out with distance so it never becomes noise).
 */
export function addSparkle(m: MeshLambertMaterial, amount = 1, cell = 5): void {
  chain(m, `sparkle${amount}:${cell}`, (sh) => {
    ensureWorldPos(sh);
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
{
  vec3 cp = floor(vPatchWPos * ${cell.toFixed(1)});
  float hs = fract(sin(dot(cp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vec3 vd = normalize(vPatchWPos - cameraPosition);
  float tw = fract(sin(dot(floor(vd * 60.0), vec3(3.1, 7.7, 1.3)) + hs * 91.0) * 4375.5);
  float fall = 1.0 - smoothstep(12.0, 60.0, length(vPatchWPos - cameraPosition));
  totalEmissiveRadiance += vec3(1.0, 0.98, 0.92) * step(0.982, hs) * step(0.55, tw) * fall * ${amount.toFixed(2)};
}`,
    );
  });
}

/** Rock strata on steep faces (world-space bands): cliffs, embankments and hillsides read as rock. */
export function addStrata(m: MeshLambertMaterial, strength = 1): void {
  chain(m, `strata${strength}`, (sh) => {
    ensureWorldPos(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vPatchUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPatchUp = normalize(mat3(modelMatrix) * objectNormal).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPatchUp;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float steep = 1.0 - smoothstep(0.55, 0.9, abs(vPatchUp));
  vec3 w = vPatchWPos;
  float band = fract(w.y * 0.42 + sin(w.x * 0.07) * 0.35 + sin(w.z * 0.05) * 0.35);
  float strata = mix(0.76, 1.1, smoothstep(0.35, 0.5, band)) * mix(0.9, 1.0, step(0.8, band));
  float grain = 0.94 + 0.06 * fract(sin(dot(floor(w * 2.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  diffuseColor.rgb *= mix(1.0, strata * grain, steep * ${strength.toFixed(2)});
}`,
      );
  });
}
