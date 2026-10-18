/* =========================================================================
   CircularGallery — vanilla JS port (no React)
   WebGL circular gallery with bending + inertia scrolling
   Generates Swiss-monochrome geometric images at runtime
   ========================================================================= */
(function () {
  'use strict';
  const OGL = window.OGL;
  if (!OGL) return;

  const { Camera, Mesh, Plane, Program, Renderer, Texture, Transform } = OGL;

  /* ---------- helpers ---------- */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function debounce(fn, wait) {
    let to; return function (...args) { clearTimeout(to); to = setTimeout(() => fn.apply(this, args), wait); };
  }

  /* ---------- generate Swiss geometric images ---------- */
  function makeImage(seed, w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const grays = ['#f2f2f2', '#e5e5e5', '#d9d9d9', '#c9c9c9', '#bfbfbf', '#111111'];
    x.fillStyle = grays[seed % 2 === 0 ? 0 : 1];
    x.fillRect(0, 0, w, h);
    const type = seed % 6;
    x.strokeStyle = '#111111'; x.fillStyle = '#111111';
    x.lineWidth = 2;
    if (type === 0) { /* concentric circles */
      for (let i = 1; i <= 5; i++) { x.beginPath(); x.arc(w/2, h/2, (i/6)*Math.min(w,h)*0.8, 0, Math.PI*2); x.globalAlpha = 0.15 + i*0.12; x.stroke(); }
    } else if (type === 1) { /* diagonal lines */
      x.globalAlpha = 0.2;
      for (let i = -h; i < w; i += 40) { x.beginPath(); x.moveTo(i, h); x.lineTo(i+h, 0); x.stroke(); }
    } else if (type === 2) { /* dot grid */
      x.globalAlpha = 0.6;
      for (let i = 20; i < w-10; i += 40) for (let j = 20; j < h-10; j += 40) { x.beginPath(); x.arc(i, j, 3, 0, Math.PI*2); x.fill(); }
    } else if (type === 3) { /* large arc */
      x.globalAlpha = 0.15; x.lineWidth = 60;
      x.beginPath(); x.arc(w*0.2, h*0.8, h*0.6, -Math.PI/3, Math.PI/3); x.stroke();
      x.globalAlpha = 0.5; x.lineWidth = 4;
      x.beginPath(); x.arc(w*0.2, h*0.8, h*0.6+40, -Math.PI/3, Math.PI/3); x.stroke();
    } else if (type === 4) { /* crosshair */
      x.globalAlpha = 0.3; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(w/2, 0); x.lineTo(w/2, h); x.moveTo(0, h/2); x.lineTo(w, h/2); x.stroke();
      x.globalAlpha = 0.6; x.lineWidth = 3;
      x.strokeRect(w*0.25, h*0.25, w*0.5, h*0.5);
      x.beginPath(); x.arc(w/2, h/2, 8, 0, Math.PI*2); x.fill();
    } else { /* quarter circles */
      x.globalAlpha = 0.2;
      x.beginPath(); x.arc(0, h, h*0.8, -Math.PI/2, 0); x.fill();
      x.globalAlpha = 0.5;
      x.beginPath(); x.arc(w, 0, h*0.6, Math.PI/2, Math.PI); x.fill();
    }
    x.globalAlpha = 1;
    return c.toDataURL('image/png');
  }

  function makeImages(count, w, h) {
    const arr = [];
    for (let i = 0; i < count; i++) arr.push(makeImage(i + 1, w, h));
    return arr;
  }

  /* ---------- text texture ---------- */
  function textTexture(gl, text, font, color) {
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    x.font = font;
    const tw = Math.ceil(x.measureText(text).width);
    const th = Math.ceil(parseInt((font.match(/(\d+)px/) || [0, 30])[1]) * 1.2);
    c.width = tw + 20; c.height = th + 20;
    x.font = font; x.fillStyle = color; x.textBaseline = 'middle'; x.textAlign = 'center';
    x.fillText(text, c.width/2, c.height/2);
    const tex = new Texture(gl, { generateMipmaps: false });
    tex.image = c;
    return { texture: tex, width: c.width, height: c.height };
  }

  /* ---------- Title mesh ---------- */
  class Title {
    constructor({ gl, plane, text, textColor, font }) {
      const { texture, width, height } = textTexture(gl, text, font, textColor);
      const geo = new Plane(gl);
      const prog = new Program(gl, {
        vertex: `attribute vec3 position;attribute vec2 uv;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragment: `precision highp float;uniform sampler2D tMap;varying vec2 vUv;void main(){vec4 c=texture2D(tMap,vUv);if(c.a<0.1)discard;gl_FragColor=c;}`,
        uniforms: { tMap: { value: texture } },
        transparent: true
      });
      this.mesh = new Mesh(gl, { geometry: geo, program: prog });
      const aspect = width / height;
      const h = plane.scale.y * 0.12;
      this.mesh.scale.set(h * aspect, h, 1);
      this.mesh.position.y = -plane.scale.y * 0.5 - h * 0.5 - 0.05;
      this.mesh.setParent(plane);
    }
  }

  /* ---------- Media (gallery item) ---------- */
  class Media {
    constructor({ geometry, gl, image, index, length, scene, screen, text, viewport, bend, textColor, borderRadius, font }) {
      this.gl = gl; this.scene = scene; this.screen = screen; this.viewport = viewport;
      this.bend = bend; this.length = length; this.index = index; this.extra = 0;
      this.speed = 0; this.isBefore = false; this.isAfter = false;
      this.borderRadius = borderRadius;
      const texture = new Texture(gl, { generateMipmaps: true });
      this.program = new Program(gl, {
        depthTest: false, depthWrite: false,
        vertex: `precision highp float;attribute vec3 position;attribute vec2 uv;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;uniform float uTime;uniform float uSpeed;varying vec2 vUv;void main(){vUv=uv;vec3 p=position;p.z=(sin(p.x*4.0+uTime)*1.5+cos(p.y*2.0+uTime)*1.5)*(0.1+uSpeed*0.5);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
        fragment: `precision highp float;uniform vec2 uImageSizes;uniform vec2 uPlaneSizes;uniform sampler2D tMap;uniform float uBorderRadius;varying vec2 vUv;
float roundedBoxSDF(vec2 p,vec2 b,float r){vec2 d=abs(p)-b;return length(max(d,vec2(0.0)))+min(max(d.x,d.y),0.0)-r;}
void main(){vec2 ratio=vec2(min((uPlaneSizes.x/uPlaneSizes.y)/(uImageSizes.x/uImageSizes.y),1.0),min((uPlaneSizes.y/uPlaneSizes.x)/(uImageSizes.y/uImageSizes.x),1.0));
vec2 uv=vec2(vUv.x*ratio.x+(1.0-ratio.x)*0.5,vUv.y*ratio.y+(1.0-ratio.y)*0.5);
vec4 color=texture2D(tMap,uv);
float d=roundedBoxSDF(vUv-0.5,vec2(0.5-uBorderRadius),uBorderRadius);
float alpha=1.0-smoothstep(-0.002,0.002,d);
gl_FragColor=vec4(color.rgb,alpha);}`,
        uniforms: {
          tMap: { value: texture },
          uPlaneSizes: { value: [0, 0] },
          uImageSizes: { value: [0, 0] },
          uSpeed: { value: 0 },
          uTime: { value: 100 * Math.random() },
          uBorderRadius: { value: borderRadius }
        },
        transparent: true
      });
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = image;
      img.onload = () => {
        texture.image = img;
        this.program.uniforms.uImageSizes.value = [img.naturalWidth, img.naturalHeight];
      };
      this.plane = new Mesh(gl, { geometry, program: this.program });
      this.plane.setParent(scene);
      this.title = new Title({ gl, plane: this.plane, text, textColor, font });
      this.resize();
    }
    update(scroll, direction) {
      this.plane.position.x = this.x - scroll.current - this.extra;
      const x = this.plane.position.x;
      const H = this.viewport.width / 2;
      if (this.bend === 0) { this.plane.position.y = 0; this.plane.rotation.z = 0; }
      else {
        const Ba = Math.abs(this.bend);
        const R = (H*H + Ba*Ba) / (2*Ba);
        const ex = Math.min(Math.abs(x), H);
        const arc = R - Math.sqrt(R*R - ex*ex);
        if (this.bend > 0) { this.plane.position.y = -arc; this.plane.rotation.z = -Math.sign(x)*Math.asin(ex/R); }
        else { this.plane.position.y = arc; this.plane.rotation.z = Math.sign(x)*Math.asin(ex/R); }
      }
      this.speed = scroll.current - scroll.last;
      this.program.uniforms.uTime.value += 0.04;
      this.program.uniforms.uSpeed.value = this.speed;
      const po = this.plane.scale.x / 2, vo = this.viewport.width / 2;
      this.isBefore = this.plane.position.x + po < -vo;
      this.isAfter = this.plane.position.x - po > vo;
      if (direction === 'right' && this.isBefore) { this.extra -= this.widthTotal; this.isBefore = this.isAfter = false; }
      if (direction === 'left' && this.isAfter) { this.extra += this.widthTotal; this.isBefore = this.isAfter = false; }
    }
    resize() {
      this.scale = this.screen.height / 1500;
      this.plane.scale.y = (this.viewport.height * (900 * this.scale)) / this.screen.height;
      this.plane.scale.x = (this.viewport.width * (700 * this.scale)) / this.screen.width;
      this.program.uniforms.uPlaneSizes.value = [this.plane.scale.x, this.plane.scale.y];
      this.padding = 2;
      this.width = this.plane.scale.x + this.padding;
      this.widthTotal = this.width * this.length;
      this.x = this.width * this.index;
    }
  }

  /* ---------- Main gallery controller ---------- */
  class CircularGallery {
    constructor(container, opts) {
      opts = opts || {};
      this.container = container;
      this.scrollSpeed = opts.scrollSpeed || 2;
      this.scroll = { ease: opts.scrollEase || 0.05, current: 0, target: 0, last: 0 };
      this.onCheckDebounce = debounce(() => this.onCheck(), 200);
      this.bend = opts.bend !== undefined ? opts.bend : 3;
      this.textColor = opts.textColor || '#111111';
      this.borderRadius = opts.borderRadius || 0.05;
      this.font = opts.font || 'bold 28px Inter, sans-serif';

      const labels = opts.items || [
        'Dashboard', 'Analytics', 'Report Cards', 'Grade Tracking', 'Class Overview', 'Student Profiles'
      ];
      const images = makeImages(labels.length, 700, 900);
      this.items = labels.map((text, i) => ({ image: images[i], text }));

      this.createRenderer();
      this.createCamera();
      this.createScene();
      this.onResize();
      this.createGeometry();
      this.createMedias();
      this.update();
      this.bind();
    }
    createRenderer() {
      this.renderer = new Renderer({ alpha: true, antialias: true, dpr: Math.min(window.devicePixelRatio || 1, 2) });
      this.gl = this.renderer.gl;
      this.gl.clearColor(0, 0, 0, 0);
      this.container.appendChild(this.gl.canvas);
      this.gl.canvas.style.width = '100%'; this.gl.canvas.style.height = '100%';
    }
    createCamera() { this.camera = new Camera(this.gl); this.camera.fov = 45; this.camera.position.z = 20; }
    createScene() { this.scene = new Transform(); }
    createGeometry() { this.geo = new Plane(this.gl, { heightSegments: 50, widthSegments: 100 }); }
    createMedias() {
      const doubled = this.items.concat(this.items);
      this.medias = doubled.map((d, i) => new Media({
        geometry: this.geo, gl: this.gl, image: d.image, index: i,
        length: doubled.length, scene: this.scene, screen: this.screen,
        text: d.text, viewport: this.viewport, bend: this.bend,
        textColor: this.textColor, borderRadius: this.borderRadius, font: this.font
      }));
    }
    onTouchDown(e) { this.isDown = true; this.scroll.position = this.scroll.current; this.start = 'touches' in e ? e.touches[0].clientX : e.clientX; }
    onTouchMove(e) {
      if (!this.isDown) return;
      const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
      this.scroll.target = (this.scroll.position || 0) + (this.start - x) * (this.scrollSpeed * 0.025);
    }
    onTouchUp() { this.isDown = false; this.onCheck(); }
    onWheel(e) {
      this.scroll.target += (e.deltaY > 0 ? this.scrollSpeed : -this.scrollSpeed) * 0.2;
      this.onCheckDebounce();
    }
    onCheck() {
      if (!this.medias || !this.medias[0]) return;
      const w = this.medias[0].width;
      const idx = Math.round(Math.abs(this.scroll.target) / w);
      const item = w * idx;
      this.scroll.target = this.scroll.target < 0 ? -item : item;
    }
    onResize() {
      this.screen = { width: this.container.clientWidth, height: this.container.clientHeight };
      this.renderer.setSize(this.screen.width, this.screen.height);
      this.camera.perspective({ aspect: this.screen.width / this.screen.height });
      const fov = (this.camera.fov * Math.PI) / 180;
      const h = 2 * Math.tan(fov / 2) * this.camera.position.z;
      this.viewport = { width: h * this.camera.aspect, height: h };
      if (this.medias) this.medias.forEach(m => { m.screen = this.screen; m.viewport = this.viewport; m.resize(); });
    }
    update() {
      this.scroll.current = lerp(this.scroll.current, this.scroll.target, this.scroll.ease);
      const dir = this.scroll.current > this.scroll.last ? 'right' : 'left';
      if (this.medias) this.medias.forEach(m => m.update(this.scroll, dir));
      this.renderer.render({ scene: this.scene, camera: this.camera });
      this.scroll.last = this.scroll.current;
      this.raf = requestAnimationFrame(() => this.update());
    }
    bind() {
      this._resize = () => this.onResize();
      this._wheel = (e) => this.onWheel(e);
      this._down = (e) => this.onTouchDown(e);
      this._move = (e) => this.onTouchMove(e);
      this._up = () => this.onTouchUp();
      window.addEventListener('resize', this._resize);
      this.container.addEventListener('wheel', this._wheel, { passive: true });
      this.container.addEventListener('mousedown', this._down);
      window.addEventListener('mousemove', this._move);
      window.addEventListener('mouseup', this._up);
      this.container.addEventListener('touchstart', this._down, { passive: true });
      this.container.addEventListener('touchmove', this._move, { passive: true });
      this.container.addEventListener('touchend', this._up);
    }
    destroy() {
      cancelAnimationFrame(this.raf);
      window.removeEventListener('resize', this._resize);
      this.container.removeEventListener('wheel', this._wheel);
      this.container.removeEventListener('mousedown', this._down);
      window.removeEventListener('mousemove', this._move);
      window.removeEventListener('mouseup', this._up);
      this.container.removeEventListener('touchstart', this._down);
      this.container.removeEventListener('touchmove', this._move);
      this.container.removeEventListener('touchend', this._up);
      if (this.gl && this.gl.canvas && this.gl.canvas.parentNode) this.gl.canvas.remove();
    }
  }

  /* auto-init on [data-gallery] elements */
  document.addEventListener('DOMContentLoaded', function () {
    var el = document.querySelector('[data-gallery]');
    if (el) {
      try {
        new CircularGallery(el, {
          bend: parseFloat(el.dataset.bend || '3'),
          textColor: el.dataset.textColor || '#111111',
          borderRadius: parseFloat(el.dataset.borderRadius || '0.05'),
          scrollSpeed: parseFloat(el.dataset.scrollSpeed || '2'),
          scrollEase: parseFloat(el.dataset.scrollEase || '0.05')
        });
      } catch (e) { console.warn('Gallery init failed:', e); }
    }
  });

  window.CircularGallery = CircularGallery;
})();
