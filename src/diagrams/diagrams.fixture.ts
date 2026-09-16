import type { ProjectDataV1 } from './diagrams.dto';

// Shared test fixture for the storage boundary, not a renderer serializer.
export function sampleProject(): ProjectDataV1 {
  return {
    version: 1,
    drawing_2d: [{ id: 'draw-1', type: 'line', x1: 10, y1: 20, x2: 30, y2: 40, color: '#2563eb', width: 4 }],
    nodes_3d: [{ id: 'node-1', placement: 'guided', chain: 'chain-1', root: [0, 1, 0], normal: [0, 1, 0], angle: 90, direction: 0, length: 0.45, color: '#2563eb' }],
    sections: [{ id: 'section-1', kind: 'space_closed_section', node_ids: ['node-1'], points: [[0, 1, 0]], color: '#2563eb' }],
    perm_rods: [{ id: 'rod-1', scalp_position: [0, 1, 0], normal: [0, 1, 0], size_mm: 19, angle: 90 }],
    waves: [{ id: 'wave-1', wave_type: 'curlS', root: [0, 1, 0], normal: [0, 1, 0], target: [0, 2, 0], amplitude: 0.1, roll: 90 }],
    timeline: { entries: [{ kind: 'create', entity: 'drawing_2d', entity_id: 'draw-1' }, { kind: 'clear_all' }], cursor: 1 },
    camera: { position: [0, 0.5, 4.3], target: [0, 0.3, 0], zoom: 1 },
    settings: { mode: 'draw', color: '#2563eb', width: 4, background: '#ffffff', grid_visible: true },
  };
}
