import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { polygon } from '@turf/helpers';
import { EnuTransform, geodeticToEcef } from '../coordinates';
import { mergeTexturedObjs, parseObj } from '../objMerge';

test('textured merge compacts indices, renames material, and copies texture', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'city4rpv-merge-'));
  try {
    const tileDir = path.join(workDir, 'tile');
    const outputDir = path.join(workDir, 'output');
    fs.mkdirSync(tileDir);
    fs.writeFileSync(path.join(tileDir, 'texture.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    fs.writeFileSync(path.join(tileDir, 'source.mtl'), [
      'newmtl surface',
      'Kd 1 1 1',
      'map_Kd texture.jpg',
    ].join('\n'));
    fs.writeFileSync(path.join(tileDir, 'tile.obj'), [
      'mtllib source.mtl',
      'v 0 0 0',
      'v 0 1 0',
      'v 0 0 1',
      'v 100 100 100',
      'vt 0 0',
      'vt 1 0',
      'vt 0 1',
      'usemtl surface',
      'f 1/1 2/2 3/3',
    ].join('\n'));

    const originEcef = geodeticToEcef(0, 0, 0);
    const transform = new EnuTransform([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      originEcef[0], originEcef[1], originEcef[2], 1,
    ], [0, 0, 0]);
    const result = mergeTexturedObjs({
      tiles: [{ tileId: 'tile0', objPath: path.join(tileDir, 'tile.obj') }],
      outputDir,
      clipFeature: polygon([[[-1, -1], [2, -1], [2, 2], [-1, 2], [-1, -1]]]),
      transform,
    });

    assert.equal(result.faceCount, 2);
    assert.equal(result.vertexCount, 4);
    assert.equal(result.textureCount, 1);
    const merged = parseObj(fs.readFileSync(path.join(outputDir, 'model.obj'), 'utf8'));
    assert.equal(merged.faces.length, 2);
    assert.equal(new Set(merged.faces.flatMap(face => face.refs.map(ref => ref.v))).size, merged.vertices.length);
    assert.match(fs.readFileSync(path.join(outputDir, 'model.mtl'), 'utf8'), /map_Kd textures\/tile0_texture\.jpg/);
    assert.equal(fs.existsSync(path.join(outputDir, 'textures', 'tile0_texture.jpg')), true);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
