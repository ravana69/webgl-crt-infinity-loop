const onecolor = one.color;

function hex2vector(cssHex) {
    const pc = onecolor(cssHex);

    return vec3.fromValues(
        pc.red(),
        pc.green(),
        pc.blue()
    );
}

const charW = 6;
const charH = 10;
const bufferCW = 80;
const bufferCH = 24;
const bufferW = bufferCW * charW;
const bufferH = bufferCH * charH;
const textureW = 512;
const textureH = 256;

const consolePad = 8; // in texels
const consoleW = bufferW + consolePad * 2;
const consoleH = bufferH + consolePad * 2;

const bufferCanvas = document.createElement('canvas');
bufferCanvas.width = bufferW;
bufferCanvas.height = bufferH;
// document.body.appendChild(bufferCanvas);

const bufferContext = bufferCanvas.getContext('2d');

bufferContext.fillStyle = '#000';
bufferContext.fillRect(0, 0, bufferW, bufferH);

function charRange(start, end) {
  return Array.apply(null, new Array(end - start)).map((_, index) => {
    return String.fromCharCode(start + index);
  });
}

const characterSet = ([]
  .concat(charRange(0x30, 0x3a)) // ASCII digits
  .concat(charRange(0x40, 0x5b)) // ASCII uppercase and @
);

// pseudo-random
// credit: https://gist.github.com/blixt/f17b47c62508be59987b
const SEED_OFFSET = new Date().getTime();

function randomize(seed) {
    const intSeed = seed % 2147483647;
    const safeSeed = intSeed > 0 ? intSeed : intSeed + 2147483646;
    return safeSeed * 16807 % 2147483647;
}

function getRandomizedFraction(seed) {
    return (seed - 1) / 2147483646;
}

let cursorX = 0, cursorY = bufferCH - 1;

const chunkList = [ '-\n' ];
let chunkIndex = 0, chunkPos = 0;

fetch('https://cdnjs.cloudflare.com/ajax/libs/gl-matrix/2.7.1/gl-matrix.js').then(response => {
  if (!response.ok) {
      throw new Error('oops');
  }

  const reader = response.body.getReader();

  const nextChunk = () => {
      reader.read().then(({ done, value }) => {
          if (done) {
              return;
          }

          chunkList.push(new TextDecoder('utf-8').decode(value));
          nextChunk();
      });
  };

  nextChunk();
});

function updateWorld(delta) {
  // redraw
  bufferContext.textAlign = 'center';
  bufferContext.font = '12px "Inconsolata"';

  const advance = 2 + Math.floor(Math.random() * 10);

  for (let i = 0; i < advance; i++) {
    const chunk = chunkList[chunkIndex];
    const char = chunk[chunkPos];
    
    // advance read head
    chunkPos += 1;
    if (chunkPos >= chunk.length) {
      chunkIndex = (chunkIndex + 1) % chunkList.length;
      chunkPos = 0;
    }

    const charCode = char.charCodeAt(0);
    if (charCode >= 32) {
      bufferContext.fillStyle = `hsl(${160 + (charCode / 256) * 60}, 100%, 60%)`;
      bufferContext.fillText(
        char,
        (cursorX + 0.5) * charW, // center inside character box
        cursorY * charH + charH,
        charW // restrict width, but allow a tiny bit of spillover
      );
      cursorX += 1;
    }

    if (charCode === 10 || cursorX >= bufferCW) {
      cursorX = 0;

      bufferContext.drawImage(
        bufferCanvas,
        0, charH, bufferW, bufferH - charH,
        0, 0, bufferW, bufferH - charH
      );

      bufferContext.fillStyle = `#000`;
      bufferContext.fillRect(0, bufferH - charH, bufferW, charH);
    }
  }
}

// "warm up" the state by simulating the world for a bit
Array.apply(null, new Array(100)).forEach(() => {
  updateWorld(0.1);
});

// let fadeCountdown = 0;

function renderWorld(delta) {
//   // fade screen every few frames
//   // (not every frame, for long trails without rounding artifacts)
//   fadeCountdown -= delta;
  
//   if (fadeCountdown < 0) {
//     bufferContext.fillStyle = 'rgba(0, 0, 0, 0.5)';  
//     bufferContext.fillRect(0, 0, bufferW, bufferH);
    
//     fadeCountdown += 0.2;
//   }

//   trails.forEach((trail, index) => {
//     const k = index / trails.length;
//     const charX = Math.floor(trail[0]);
    
//     // randomize based on character position
//     const charSeed = index + (charX + trail[1] * bufferCW) * 50;
//     const outSeed = randomize(charSeed * 1500 + SEED_OFFSET);

//     const char = characterSet[Math.floor(getRandomizedFraction(outSeed) * characterSet.length)];

//   }); 
}

// init WebGL
const regl = createREGL({
    canvas: document.body.querySelector('canvas'),
    attributes: { antialias: true, alpha: false, preserveDrawingBuffer: true }
});

const spriteTexture = regl.texture({
    width: textureW,
    height: textureH,
    mag: 'linear'
});

const termFgColor = hex2vector('#efe');
const termBgColor = hex2vector('#202520');

const quadCommand = regl({
    vert: `
        precision mediump float;

        attribute vec3 position;

        varying vec2 uvPosition;

        void main() {
            uvPosition = position.xy * vec2(0.5, -0.5) + vec2(0.5);

            gl_Position = vec4(
                vec2(-1.0, 1.0) + (position.xy - vec2(-1.0, 1.0)) * 1.0,
                0.0,
                1.0
            );
        }
    `,

    frag: `
        precision mediump float;

        varying vec2 uvPosition;

        uniform sampler2D sprite;
        uniform float time;
        uniform float glitchLine;
        uniform float glitchFlutter;
        uniform float glitchAmount;
        uniform float glitchDistance;
        uniform vec3 bgColor;
        uniform vec3 fgColor;

        #define curvature 1.0
        #define textureW ${textureW + '.0'}
        #define textureH ${textureH + '.0'}
        #define consoleW ${consoleW + '.0'}
        #define consoleH ${consoleH + '.0'}

        vec3 renderFacet(vec2 facetOrigin, vec2 facetSize, vec2 facetWH, vec2 facetTexelUV, float facetGlitchLine, vec2 textureLookupRatio) {
            float facetH = facetWH.y;

            // simulate 2x virtual pixel size, for crisp display on low-res
            vec2 inTexel = mod(facetTexelUV * facetWH * 0.5, vec2(1.0));

            float facetGlitchDistance = glitchDistance / facetSize.y;
            float distToGlitch = facetGlitchLine - (facetTexelUV.y - inTexel.y / facetH);
            float glitchOffsetLinear = step(0.0, distToGlitch) * max(0.0, facetGlitchDistance - distToGlitch) / facetGlitchDistance;
            float glitchOffset = glitchOffsetLinear * glitchOffsetLinear;

            facetTexelUV.x -= glitchOffset * glitchAmount + 0.081 * (glitchFlutter * glitchFlutter * glitchFlutter);

            vec2 inTexelOffset = inTexel - 0.5;
            vec2 uvAdjustment = inTexelOffset * vec2(0.0, .5 / facetH); // remove vertical texel interpolation
            vec2 distortedUVPosition = facetOrigin + (facetTexelUV - uvAdjustment) * facetSize;

            vec4 sourcePixel = texture2D(
                sprite,
                distortedUVPosition * textureLookupRatio
            );

            // multiply by source alpha as well
            vec3 pixelRGB = sourcePixel.rgb * sourcePixel.a;

            float scanlineAmount = inTexelOffset.y * inTexelOffset.y / 0.25;
            float intensity = 12.0 - scanlineAmount * 3.0; // ray intensity is over-amped by default
            vec3 glitchLineAmp = vec3(0.7, 0.15, 0.1) * glitchOffset * 20.0;

            return mix(
                bgColor,
                fgColor,
                intensity * pixelRGB
            ) * (1.0 - 0.5 * scanlineAmount) + glitchLineAmp;
        }

        void main() {
            // @todo use uniform
            vec2 consoleWH = vec2(consoleW, consoleH);
            float maxMixFactor = 8.0;
            float mixFactor = max(0.0, mod(time * 0.5, maxMixFactor + 2.0) - 2.0);
            float globalLoopMix = (mixFactor / maxMixFactor);
            globalLoopMix *= globalLoopMix; // slow at first
            //float mixFactor = maxMixFactor - abs(mod(time * 0.5, maxMixFactor * 2.0) - maxMixFactor);
            vec2 textureLookupRatio = consoleWH / vec2(textureW, textureH);

            vec2 globalCenterOffset = uvPosition - vec2(0.5);
            float globalDistortionFactor = dot(globalCenterOffset, globalCenterOffset) * curvature * globalLoopMix;
            vec2 globalTexelUV = uvPosition + globalCenterOffset * (1.0 - globalDistortionFactor) * globalDistortionFactor; // pixel position in parent-relative UV
            vec2 fromGlobalEdge = vec2(0.5) - abs(globalTexelUV - vec2(0.5));

            vec2 parentOrigin = vec2(0); // parent origin in global UV
            vec2 parentSize = vec2(1.0); // parent size in global UV
            vec2 parentWH = consoleWH; // parent size in texels
            vec2 parentUV = globalTexelUV; // pixel position in parent-relative UV
            float parentEdgeSize = 0.1;

            int maxLevels = int(mixFactor);
            for(int level = 0; level < 7; level++) {
              if (level >= maxLevels) {
                break;
              }

              parentSize *= 0.5;
              parentOrigin += floor(parentUV / 0.5) * parentSize;
              parentUV = mod(parentUV, 0.5) / 0.5;
              parentWH *= 0.5;
              parentEdgeSize *= 1.75; // tighten up edge feathering
              mixFactor -= 1.0;
            }

            vec2 parentCenterOffset = parentUV - vec2(0.5);
            float parentDistortionFactor = dot(parentCenterOffset, parentCenterOffset) * curvature;
            vec2 parentTexelUV = parentUV + parentCenterOffset * (1.0 - parentDistortionFactor) * parentDistortionFactor; // intended texture coordinates inside parent UV

            vec2 facetOriginInParent = floor(parentUV / 0.5) * 0.5;
            vec2 facetOrigin = parentOrigin + parentSize * facetOriginInParent; // facet origin in global UV
            vec2 facetWH = parentWH * 0.5; // facet size in texels
            vec2 facetUV = (parentUV - facetOriginInParent) / vec2(0.5); // pixel position inside facet

            vec2 facetCenterOffset = facetUV - vec2(0.5);
            float facetDistortionFactor = dot(facetCenterOffset, facetCenterOffset) * curvature;
            vec2 facetTexelUV = facetUV + facetCenterOffset * (1.0 - facetDistortionFactor) * facetDistortionFactor; // intended texture coordinates inside facet UV

            vec2 parentFacetTexelUV = (parentTexelUV - facetOriginInParent) / 0.5; // parent texture coordinates inside facet UV

            float edgeFadeMixFactor = (clamp(mixFactor, 0.8, 0.95) - 0.8) / 0.15;
            float distortionMixFactor = (max(mixFactor, 0.95) - 0.95) / 0.05;

            // blended target texture coordinates inside facet UV
            vec2 blendedTexelUV = mix(parentFacetTexelUV, facetTexelUV, distortionMixFactor);

            vec2 fromFacetEdge = vec2(0.5) - abs(blendedTexelUV - vec2(0.5)); // use blended position
            vec2 fromParentEdge = vec2(0.5) - abs(parentTexelUV - vec2(0.5));

            if (fromFacetEdge.x > 0.0 && fromFacetEdge.y > 0.0 && fromGlobalEdge.x > 0.0 && fromGlobalEdge.y > 0.0) {
                vec2 fromParentEdgePixel = min(parentEdgeSize * parentWH * fromParentEdge, vec2(1.0, 1.0));
                vec2 fromEdgePixel = min(parentEdgeSize * facetWH * fromFacetEdge, vec2(1.0, 1.0));
                vec2 fromGlobalEdgePixel = min(0.1 * consoleWH * fromGlobalEdge, vec2(1.0, 1.0));

                // fade faster near the parent's center
                float distanceAmount = 4.0 * dot(parentCenterOffset, parentCenterOffset);
                float edgeMixCurve = 2.0 * edgeFadeMixFactor * (1.0 - edgeFadeMixFactor);
                float edgeFade = mix(
                    fromParentEdgePixel.x * fromParentEdgePixel.y,
                    fromEdgePixel.x * fromEdgePixel.y,
                    edgeFadeMixFactor - distanceAmount * edgeMixCurve
                );

                float loopedEdgeFade = edgeFade * mix(
                    1.0,
                    fromGlobalEdgePixel.x * fromGlobalEdgePixel.y,
                    globalLoopMix
                );

                float screenFade = mix(
                    1.0 - dot(parentCenterOffset, parentCenterOffset) * 1.8,
                    1.0 - dot(facetCenterOffset, facetCenterOffset) * 1.8,
                    edgeFadeMixFactor
                );

                float loopedScreenFade = screenFade * mix(
                    1.0,
                    1.0 - dot(globalCenterOffset, globalCenterOffset) * 1.8,
                    globalLoopMix
                );

                vec2 facetSize = parentSize * 0.5;
                float facetGlitchLine = (glitchLine - facetOrigin.y) / facetSize.y;

                gl_FragColor = vec4(
                    loopedEdgeFade * loopedScreenFade * renderFacet(
                        facetOrigin,
                        facetSize,
                        facetWH,
                        blendedTexelUV,
                        facetGlitchLine,
                        textureLookupRatio
                    ),
                    0.2
                );
            } else {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            }
        }
    `,

    attributes: {
        position: regl.buffer([
            [ -1, -1, 0 ],
            [ 1, -1, 0 ],
            [ -1, 1, 0 ],
            [ 1, 1, 0 ]
        ])
    },

    uniforms: {
        time: regl.context('time'),
        glitchLine: regl.prop('glitchLine'),
        glitchFlutter: regl.prop('glitchFlutter'),
        glitchAmount: regl.prop('glitchAmount'),
        glitchDistance: regl.prop('glitchDistance'),
        camera: regl.prop('camera'),
        sprite: spriteTexture,
        bgColor: regl.prop('bgColor'),
        fgColor: regl.prop('fgColor')
    },

    primitive: 'triangle strip',
    count: 4,

    depth: {
        enable: false
    },

    blend: {
        enable: true,
        func: {
            src: 'src alpha',
            dst: 'one minus src alpha'
        }
    }
});

regl.clear({
    depth: 1,
    color: [ 0, 0, 0, 1 ]
});

// main loop
let currentTime = performance.now();
let elapsedTime = 0;

function rafBody() {
  // measure time
  const newTime = performance.now();
  const delta = Math.min(0.05, (newTime - currentTime) / 1000); // apply limiter to avoid frame skips
  currentTime = newTime;
  elapsedTime += delta;

  // glitch settings
  const glitchLine = (0.8 + elapsedTime * 0.27) % 1.0;
  const glitchFlutter = (elapsedTime * 40.0) % 1.0; // timed to be slightly out of sync from main frame rate
  const glitchAmount = 0.06 + glitchFlutter * 0.01;
  const glitchDistance = 0.04 + glitchFlutter * 0.35;

  updateWorld(delta);
  renderWorld(delta);

  regl.poll();
  spriteTexture.subimage(bufferContext, consolePad, consolePad);
  quadCommand({
    bgColor: termBgColor,
    fgColor: termFgColor,
    
    glitchLine,
    glitchFlutter,
    glitchAmount,
    glitchDistance
  });

  requestAnimationFrame(rafBody);
}

// kickstart the loop
rafBody();

