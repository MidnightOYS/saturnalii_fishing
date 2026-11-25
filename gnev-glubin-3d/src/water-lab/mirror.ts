import * as T from 'three';
import type {createLabUniforms} from './shared';

export function createLabMirror(renderer:T.WebGLRenderer, scene:T.Scene, uniforms:ReturnType<typeof createLabUniforms>, reflectionLayer:number|'camera'=1) {
  const target = new T.WebGLRenderTarget(1,1);
  const camera = new T.OrthographicCamera();
  if (reflectionLayer !== 'camera') camera.layers.set(reflectionLayer);
  const aim = new T.Vector3(), bg = new T.Color(), buffer = new T.Vector2();
  const aboveWater = new T.Plane(new T.Vector3(0,1,0),.05);
  uniforms.uLabMirror.value=target.texture;
  return {
    render(eye:T.OrthographicCamera) {
      renderer.getDrawingBufferSize(buffer);
      const ratio=Math.min(.48,860/Math.max(buffer.x,buffer.y));
      const width=Math.max(1,Math.round(buffer.x*ratio)), height=Math.max(1,Math.round(buffer.y*ratio));
      if(target.width!==width || target.height!==height) target.setSize(width,height);
      camera.projectionMatrix.copy(eye.projectionMatrix);
      camera.projectionMatrixInverse.copy(eye.projectionMatrixInverse);
      if (reflectionLayer === 'camera') camera.layers.mask=eye.layers.mask;
      eye.getWorldPosition(camera.position); camera.position.y*=-1;
      eye.getWorldDirection(aim); aim.y*=-1;
      camera.up.setFromMatrixColumn(eye.matrixWorld,1); camera.up.y*=-1;
      camera.lookAt(aim.add(camera.position));camera.updateMatrixWorld();
      uniforms.uMirrorVP.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      const oldTarget=renderer.getRenderTarget(), oldBg=scene.background,alpha=renderer.getClearAlpha();
      const clip=renderer.clippingPlanes;renderer.getClearColor(bg);
      try {
        scene.background=null;renderer.clippingPlanes=[aboveWater];
        renderer.setClearColor(0,0);renderer.setRenderTarget(target);renderer.render(scene,camera);
      } finally {
        renderer.setRenderTarget(oldTarget);renderer.clippingPlanes=clip;renderer.setClearColor(bg,alpha);scene.background=oldBg;
      }
    },
    dispose:()=>target.dispose(),
  };
}
