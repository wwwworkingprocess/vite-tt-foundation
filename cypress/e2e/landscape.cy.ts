import type { LandscapeDetailPlan } from '../../apps/web/src/representation/d3d-landscape-scene.js';
const landscapeMap = () =>
  cy.get<HTMLElement>('[data-testid="d3d-map-representation"]', {
    timeout: 15000,
  });
const landscapeCameraDrawn = () =>
  landscapeMap().should((m) => {
    for (const key of ['zoom', 'target-x', 'target-z'])
      expect(Number(m.attr('data-rendered-camera-' + key))).to.be.closeTo(
        Number(m.attr('data-camera-' + key)),
        1e-10,
      );
  });
const landscapeZoom = (units: number) =>
  landscapeMap().then((m) => {
    const desired =
      20 / (Number(m.attr('data-camera-viewport-height')) * units);
    cy.wrap(m.find('canvas')[0]!).trigger('wheel', {
      deltaY: -Math.log(desired / Number(m.attr('data-camera-zoom'))) * 1000,
    });
  });
const landscapeTarget = (target: { x: number; z: number }) => {
  landscapeMap().then((m) => {
    const canvas = m.find('canvas')[0]!,
      r = canvas.getBoundingClientRect(),
      units =
        20 /
        (Number(m.attr('data-camera-viewport-height')) *
          Number(m.attr('data-camera-zoom'))),
      x = target.x - Number(m.attr('data-camera-target-x')),
      z = target.z - Number(m.attr('data-camera-target-z')),
      dx = (z - x) / (Math.SQRT2 * units),
      dy = (-(x + z) * Math.sin((35 * Math.PI) / 180)) / (Math.SQRT2 * units);
    for (const [type, a, b] of [
      ['pointerdown', 0, 0],
      ['pointermove', dx, dy],
      ['pointerup', dx, dy],
    ] as const)
      cy.wrap(canvas).trigger(type, {
        eventConstructor: 'PointerEvent',
        pointerId: 1,
        clientX: r.left + 10 + a,
        clientY: r.top + 10 + b,
      });
  });
  landscapeCameraDrawn();
};
const landscapeDrawn = () =>
  landscapeMap()
    .should('have.attr', 'data-landscape-status', 'ready')
    .should((m) => {
      expect(m.attr('data-rendered-landscape-identity')).to.equal(
        m.attr('data-landscape-identity'),
      );
      expect(Number(m.attr('data-landscape-gpu-instances'))).to.be.within(
        1,
        8000,
      );
      expect(Number(m.attr('data-landscape-instances'))).to.be.within(1, 8000);
      expect(Number(m.attr('data-landscape-batches'))).to.be.within(1, 8);
      expect(Number(m.attr('data-landscape-triangles'))).to.be.within(
        1,
        180000,
      );
      expect(m.attr('data-landscape-unsupported-supports')).to.equal('{}');
    });
const landscapeRecord = (name: string) => {
  landscapeCameraDrawn();
  landscapeMap().then((m) =>
    cy.writeFile(
      'node_modules/.cache/street-cells/landscape-v1/browser-' + name + '.json',
      { ...m[0]!.dataset },
    ),
  );
  cy.screenshot('landscape-' + name, {
    capture: 'viewport',
    disableTimersAndAnimations: false,
  });
};
const landscapeNormal = () =>
  landscapeMap().then((m) => {
    if (m.attr('data-representation-mode') === 'mini') {
      cy.get(
        'button[aria-label="Select mini representation for swap"]',
      ).click();
      cy.contains('button', 'Swap visualizations').click();
    }
  });
const pauseLandscape = () =>
  cy.get('body').then((b) => {
    if (
      b
        .find('button')
        .toArray()
        .some((e) => e.textContent?.trim() === 'Pause')
    )
      cy.contains('button', /^Pause$/).click();
  });
it('draws bounded Mediterranean masks, reuses static near plans, preserves POIs and switches partial/unavailable cities', () => {
  let archives = 0;
  cy.intercept('GET', '**/street-cells/street-cells.zip*', () => {
    archives++;
  });
  cy.visit('/');
  cy.get('[data-testid="open-screen"]', { timeout: 15000 }).should(
    'be.visible',
  );
  cy.contains('label', 'Scenario')
    .find('select')
    .select('torrevieja-legacy-all-v1');
  cy.contains('button', 'Start new game').should('be.enabled').click();
  pauseLandscape();
  landscapeNormal();
  landscapeMap()
    .should('have.attr', 'data-city-building-count', '16231')
    .and('have.attr', 'data-settlement-metadata-status', 'ready')
    .and('have.attr', 'data-terrain-elevation-scale', '5')
    .and('have.attr', 'data-street-cells-status', 'hidden');
  landscapeZoom(0.014);
  landscapeDrawn();
  landscapeMap().then((m) => {
    const rows = JSON.parse(m.attr('data-landscape-diagnostics')!) as {
      maskId: string;
      variantId: string;
      seed: number;
      accepted: number;
    }[];
    for (const [maskId, variantId, seed] of [
      ['es-torrevieja-mask-s%3AR14980058-0', 'coastal-palms', 1042],
      ['es-torrevieja-mask-s%3AR14606438-0', 'olive-grove', 2042],
    ] as const) {
      const row = rows.find((r) => r.maskId === maskId)!;
      expect(row.variantId).to.equal(variantId);
      expect(row.seed).to.equal(seed);
      expect(row.accepted).to.be.greaterThan(0);
    }
    expect(rows.some((r) => r.maskId.includes('R14960789'))).to.equal(false);
  });
  // Fixed camera targets were computed read-only from the accepted V4 polygons.
  for (const p of [
    { id: 'coastal-park', x: 31.353589931763754, z: -1.4881247971796348 },
    { id: 'olive-park', x: 24.005726424302022, z: -7.368240509598383 },
    { id: 'suburban-garden', x: 8.200962328522321, z: -5.970646397561202 },
    { id: 'dry-grass', x: -21.7106318263561, z: 43.65103493640294 },
    { id: 'recreation', x: -31.590774526205237, z: 52.28667782723267 },
  ]) {
    landscapeTarget(p);
    landscapeDrawn();
    landscapeRecord(p.id);
  }
  landscapeMap().then((m) => {
    const identity = m.attr('data-landscape-identity'),
      bytes = m.attr('data-landscape-gpu-bytes'),
      diagnostics = m.attr('data-landscape-diagnostics');
    landscapeTarget({ x: 23, z: 0 });
    landscapeTarget({ x: 24, z: 1 });
    landscapeMap()
      .should('have.attr', 'data-landscape-identity', identity)
      .and('have.attr', 'data-landscape-gpu-bytes', bytes)
      .and('have.attr', 'data-landscape-diagnostics', diagnostics);
  });
  cy.task('materializationControlSamples').then((raw) => {
    for (const p of raw as {
      name: string;
      id: string;
      x: number;
      z: number;
    }[]) {
      landscapeZoom(p.name === 'laguna-rosa' ? 0.055 : 0.014);
      landscapeTarget(p);
      landscapeDrawn();
      landscapeRecord('control-' + p.name);
    }
  });
  landscapeZoom(0.1);
  landscapeDrawn();
  landscapeMap().should((m) => {
    expect(Number(m.attr('data-landscape-triangles'))).to.be.at.most(40000);
    expect(Number(m.attr('data-landscape-instances'))).to.be.at.most(2000);
    expect(Number(m.attr('data-landscape-gpu-instances'))).to.be.at.most(2000);
    expect(Number(m.attr('data-landscape-batches'))).to.be.at.most(6);
  });
  landscapeTarget({ x: 0, z: 0 });
  landscapeRecord('medium');
  landscapeZoom(0.4);
  landscapeCameraDrawn();
  landscapeMap()
    .should('have.attr', 'data-landscape-status', 'inactive')
    .and('have.attr', 'data-landscape-instances', '0')
    .and('have.attr', 'data-rendered-landscape-identity', '');
  landscapeRecord('far');
  const changeCity = (city: string, scenario: string) => {
    cy.get('[data-testid="scenario-menu-trigger"]').click();
    cy.get('select[aria-label="City"]').select(city);
    cy.get('select[aria-label="City"]').should('have.value', city);
    cy.get('[data-testid="scenario-status"]').should(
      'have.text',
      'Scenario status: ready',
    );
    cy.contains('label', 'Scenario')
      .find('select')
      .should('be.enabled')
      .select(scenario);
    cy.get('[data-testid="scenario-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="scenario-menu-trigger"]').click();
    cy.contains('button', 'Restart').click();
    landscapeMap().should('have.attr', 'data-scenario-id', scenario);
    pauseLandscape();
    landscapeNormal();
  };
  changeCity('es-elche', 'elche-urban-abc-v1');
  landscapeMap()
    .should('have.attr', 'data-city-building-count', '6510')
    .and('have.attr', 'data-typed-masks-availability', 'partial');
  landscapeZoom(0.014);
  landscapeDrawn();
  landscapeRecord('elche-partial');
  changeCity('es-alicante', 'alicante-legacy-core-v1');
  landscapeMap()
    .should('have.attr', 'data-city-building-count', '13804')
    .and('have.attr', 'data-typed-masks-availability', 'unavailable');
  landscapeZoom(0.014);
  landscapeMap()
    .should('have.attr', 'data-landscape-status', 'ready')
    .and('have.attr', 'data-landscape-instances', '0')
    .and('have.attr', 'data-rendered-landscape-identity', '');
  landscapeRecord('alicante-unavailable');
  changeCity('es-torrevieja', 'torrevieja-legacy-all-v1');
  landscapeMap().should('have.attr', 'data-city-building-count', '16231');
  landscapeZoom(0.014);
  landscapeDrawn();
  cy.then(() => expect(archives).to.equal(1));
});
it('renders a labeled diagnostic of all five low-poly families and real GPU instance-color variation', () => {
  cy.visit('/');
  cy.window()
    .then(async (win) => {
      // Trusted local Vite module boundary, exactly the modules exercised by the game.
      const three = await (win.eval(
        'import("/node_modules/.vite/deps/three.js")',
      ) as Promise<typeof import('three')>);
      const kits = await (win.eval(
        'import("/src/representation/d3d-landscape-geometry.ts")',
      ) as Promise<
        typeof import('../../apps/web/src/representation/d3d-landscape-geometry.js')
      >);
      const gpu = await (win.eval(
        'import("/src/representation/D3dLandscapeDetails.tsx")',
      ) as Promise<
        typeof import('../../apps/web/src/representation/D3dLandscapeDetails.js')
      >);
      const scene = new three.Scene();
      scene.background = new three.Color('#e3e9dc');
      scene.add(new three.AmbientLight(0xffffff, 0.85));
      const light = new three.DirectionalLight(0xffffff, 1.6);
      light.position.set(-40, 80, 30);
      scene.add(light);
      const families = [
        'palm',
        'olive',
        'carob',
        'succulent',
        'scrub',
      ] as const;
      const instances = families.flatMap((family, col) =>
        Array.from({ length: 3 }, (_, row) => {
          const info = kits.landscapePrototypeInfo[family];
          return {
            id: family + row,
            maskId: 'illustrative-prototype-only',
            family,
            x: (col - 2) * 11,
            y: 0,
            z: (row - 1) * 11,
            width: info.width,
            depth: info.depth,
            height: info.height,
            rotation: row * 0.3,
            colorVariant: row,
          };
        }),
      );
      const plan: LandscapeDetailPlan = {
        identity: 'prototype-diagnostic',
        gpuInstances: 24,
        availability: 'illustrative',
        instances,
        triangles: 0,
        proposals: 0,
        diagnostics: [],
        numericBytes: 960,
        terrainIndexBytes: 0,
        suppressedMasks: [],
        unsupportedSupports: {},
      };
      const resources = gpu.createLandscapeResources(plan),
        meshes = resources.batches.map((b) => {
          const mesh = new three.InstancedMesh(
            b.geometry,
            b.material,
            b.instances.length,
          );
          gpu.writeLandscapeInstances(mesh, b);
          scene.add(mesh);
          return mesh;
        });
      const renderer = new three.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(1000, 500);
      const camera = new three.OrthographicCamera(
        -29,
        29,
        14.5,
        -14.5,
        0.1,
        200,
      );
      camera.position.set(15, 35, 60);
      camera.lookAt(0, 3, 0);
      const element = win.document.createElement('div');
      element.id = 'landscape-prototype-proof';
      Object.assign(element.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '99999',
        background: '#e3e9dc',
        color: '#304d48',
      });
      element.append(renderer.domElement);
      const label = win.document.createElement('p');
      label.textContent =
        'Illustrative prototype diagnostic: palm | olive | carob | succulent | scrub — three instance-color variants each; no geographic placement';
      element.append(label);
      win.document.body.append(element);
      renderer.render(scene, camera);
      expect(resources.batches).to.have.length(8);
      expect(new Set(resources.batches.map((b) => b.material)).size).to.equal(
        1,
      );
      expect(meshes.every((m) => m.instanceColor !== null)).to.equal(true);
      return {
        renderer,
        resources,
        meshes,
        element,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      };
    })
    .then((proof) => {
      cy.get('#landscape-prototype-proof').screenshot(
        'landscape-prototype-families',
        { disableTimersAndAnimations: false },
      );
      cy.writeFile(
        'node_modules/.cache/street-cells/landscape-v1/prototype-browser.json',
        {
          calls: proof.calls,
          triangles: proof.triangles,
          batches: proof.resources.batches.length,
          gpuBytes: proof.resources.gpuBytes,
        },
      );
      cy.then(() => {
        proof.element.remove();
        for (const mesh of proof.meshes) mesh.dispose();
        proof.resources.dispose();
        proof.renderer.dispose();
      });
    });
});
