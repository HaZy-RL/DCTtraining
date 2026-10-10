// Shared lighting + post-processing for every 3D scene: image-based reflections from soft light panels,
// ambient occlusion for contact shadows, bloom so LEDs glow, SMAA edges and a light vignette.
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, N8AO, SMAA, Vignette } from '@react-three/postprocessing';
import { useStore } from '../../store';

export function Look({ aoRadius = 2, aoIntensity = 2.2, bloom = 0.9, envIntensity = 1 }: { aoRadius?: number; aoIntensity?: number; bloom?: number; envIntensity?: number }) {
  const quality = useStore((s) => s.progress.settings.quality);
  return (
    <>
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={2.2 * envIntensity} position={[0, 30, 0]} rotation-x={Math.PI / 2} scale={[80, 20, 1]} />
        <Lightformer intensity={1.2 * envIntensity} position={[0, 10, 30]} scale={[80, 12, 1]} />
        <Lightformer intensity={1.2 * envIntensity} position={[0, 10, -30]} rotation-y={Math.PI} scale={[80, 12, 1]} />
        <Lightformer intensity={0.6 * envIntensity} color="#9fd3ff" position={[40, 10, 0]} rotation-y={-Math.PI / 2} scale={[40, 12, 1]} />
        <Lightformer intensity={0.5 * envIntensity} color="#ffe2b8" position={[-40, 10, 0]} rotation-y={Math.PI / 2} scale={[40, 12, 1]} />
      </Environment>
      {quality === 'high' && (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <N8AO aoRadius={aoRadius} intensity={aoIntensity} distanceFalloff={1} quality="medium" halfRes />
          <Bloom mipmapBlur luminanceThreshold={1.05} luminanceSmoothing={0.2} intensity={bloom} radius={0.6} />
          <SMAA />
          <Vignette eskil={false} offset={0.25} darkness={0.45} />
        </EffectComposer>
      )}
    </>
  );
}
