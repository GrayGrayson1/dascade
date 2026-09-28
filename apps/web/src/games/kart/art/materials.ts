/**
 * Shared materials. Everything built with MeshBuilder uses the "voxel" material: Lambert lighting
 * (cheap), vertex colours, plus
 *  - a per-vertex `glow` attribute that adds self-illumination (screens, eyes, neon, exhausts), and
 *  - an optional fresnel rim light (karts, items) so silhouettes pop against any background.
 * Everything stays one draw call per mesh and needs no extra lights.
 */
import { Color, DoubleSide, MeshBasicMaterial, MeshLambertMaterial, type Material, type WebGLProgramParametersWithUniforms } from 'three';

export interface RimUniforms {
  rimColor: { value: Color };
  rimStrength: { value: number };
}

function patch(rim: RimUniforms | null) {
  return (shader: WebGLProgramParametersWithUniforms) => {
    if (rim) {
      shader.uniforms.rimColor = rim.rimColor;
      shader.uniforms.rimStrength = rim.rimStrength;
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    let frag = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying float vGlow;${rim ? '\nuniform vec3 rimColor;\nuniform float rimStrength;' : ''}`);
    frag = frag.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vGlow;${
        rim
          ? `
{
  float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float rimF = pow(1.0 - ndv, 2.5);
  totalEmissiveRadiance += rimColor * rimF * rimStrength;
}`
          : ''
      }`,
    );
    shader.fragmentShader = frag;
  };
}

export interface VoxelMaterialOptions {
  transparent?: boolean;
  opacity?: number;
  doubleSide?: boolean;
  depthWrite?: boolean;
  /** Add fresnel rim lighting (karts, items). */
  rim?: boolean;
}

export function makeVoxelMaterial(o: VoxelMaterialOptions = {}): MeshLambertMaterial {
  const m = new MeshLambertMaterial({
    vertexColors: true,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    depthWrite: o.depthWrite ?? true,
  });
  // (never pass `side: undefined`: three.js logs a warning for undefined parameters)
  if (o.doubleSide) m.side = DoubleSide;
  const rim: RimUniforms | null = o.rim ? { rimColor: { value: new Color(0xbfe8ff) }, rimStrength: { value: 0.55 } } : null;
  m.onBeforeCompile = patch(rim);
  m.customProgramCacheKey = () => (rim ? 'dasphalt-voxel-rim' : 'dasphalt-voxel');
  if (rim) m.userData.rim = rim;
  return m;
}

/** Rim uniforms of a rim-lit voxel material (to tint per biome), or null. */
export function rimOf(m: Material): RimUniforms | null {
  return (m.userData.rim as RimUniforms | undefined) ?? null;
}

/** Unlit vertex-coloured material (glowing things, far LODs in the fog). */
export function makeUnlitMaterial(o: VoxelMaterialOptions = {}): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    vertexColors: true,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    depthWrite: o.depthWrite ?? true,
  });
  if (o.doubleSide) m.side = DoubleSide;
  return m;
}

/** Shared singletons for art that lives in more than one place (portraits, renderer). */
let shared: { voxel: MeshLambertMaterial; kart: MeshLambertMaterial; ghost: MeshLambertMaterial } | null = null;
export function sharedMaterials(): { voxel: MeshLambertMaterial; kart: MeshLambertMaterial; ghost: MeshLambertMaterial } {
  if (!shared)
    shared = {
      voxel: makeVoxelMaterial(),
      kart: makeVoxelMaterial({ rim: true }),
      ghost: makeVoxelMaterial({ transparent: true, opacity: 0.42, depthWrite: false, rim: true }),
    };
  return shared;
}

export function disposeSharedMaterials(): void {
  if (!shared) return;
  for (const m of Object.values(shared) as Material[]) m.dispose();
  shared = null;
}
