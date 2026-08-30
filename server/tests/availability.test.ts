import { describe, expect, it } from 'vitest';

import {
  PILOT_MANIFEST_VERSION,
  createPilotAvailability,
  PilotAvailabilityError,
  type RuntimeRole
} from '../src/pilot/availability';

const availability = createPilotAvailability();

describe('PilotAvailability manifest', () => {
  it('is versioned', () => {
    expect(PILOT_MANIFEST_VERSION).toBe('vve.pilot-availability/1');
  });

  it('snapshots the pilot teacher surface exactly', () => {
    const manifest = availability.resolve({ environment: 'pilot', role: 'teacher' });
    expect(manifest.features).toEqual([
      'tool.select',
      'tool.pan',
      'tool.pen',
      'tool.text',
      'tool.eraser',
      'tool.shapes',
      'tool.undo',
      'tool.redo',
      'tool.clearBoard',
      'panel.calculator',
      'panel.mathGraph',
      'panel.physicsGraph',
      'panel.coordinateSystem',
      'panel.inputStyle',
      'panel.imagePaste',
      'panel.pdfImport',
      'panel.pdfExport',
      'surface.teacherDashboard',
      'surface.boardSession'
    ]);
  });

  it('gives the student the same tools minus whole-board clear', () => {
    const teacher = availability.resolve({ environment: 'pilot', role: 'teacher' });
    const student = availability.resolve({ environment: 'pilot', role: 'student' });
    expect([...student.features].sort()).toEqual(
      [
        ...teacher.features.filter((id) => id !== 'tool.clearBoard' && id !== 'surface.teacherDashboard'),
        'surface.studentEntry'
      ].sort()
    );
    expect(student.features).toContain('tool.pen');
    expect(student.features).not.toContain('tool.clearBoard');
    expect(student.features).toContain('surface.studentEntry');
  });

  it('excludes every experiment and legacy surface from the pilot manifest', () => {
    const excluded = [
      'experiment.ai',
      'experiment.chemistry',
      'experiment.gridAlign',
      'dev.legacyPeerRooms',
      'dev.rawBoardTransfer',
      'dev.debugControls',
      'http.ai',
      'http.roomsApi'
    ];
    for (const role of ['administrator', 'teacher', 'student', 'developer', 'server'] as RuntimeRole[]) {
      const manifest = availability.resolve({ environment: 'pilot', role });
      for (const feature of excluded) {
        expect(manifest.features, `${feature} must be absent for pilot/${role}`).not.toContain(feature);
      }
    }
  });

  it('lists dev-only features in the development manifest but denies them without the internal flag', () => {
    const manifest = availability.resolve({ environment: 'development', role: 'developer' });
    expect(manifest.features).toContain('dev.legacyPeerRooms');

    const withoutFlag = availability.require('dev.legacyPeerRooms', {
      environment: 'development',
      role: 'developer'
    });
    expect(withoutFlag).toEqual({
      available: false,
      feature: 'dev.legacyPeerRooms',
      reason: 'dev-surface-required'
    });

    const withFlag = availability.require('dev.legacyPeerRooms', {
      environment: 'development',
      role: 'developer',
      devSurface: true
    });
    expect(withFlag.available).toBe(true);
  });

  it('keeps server route groups stable across environments for always-on groups', () => {
    const pilot = availability.resolve({ environment: 'pilot', role: 'server' });
    expect(pilot.serverRoutes).toEqual([
      'http.adminTeachers',
      'http.teacherAuth',
      'http.teacherBoards',
      'http.boardAccess'
    ]);
    const dev = availability.resolve({ environment: 'development', role: 'server' });
    expect(dev.serverRoutes).toEqual([
      'http.adminTeachers',
      'http.teacherAuth',
      'http.teacherBoards',
      'http.boardAccess',
      'http.ai',
      'http.roomsApi'
    ]);
  });

  it('fails closed on unknown feature ids', () => {
    const decision = availability.require('experiment.telepathy' as any, {
      environment: 'pilot',
      role: 'teacher'
    });
    expect(decision).toEqual({ available: false, feature: null, reason: 'unknown-feature' });
  });

  it('never lets a dev surface flag or role widen the pilot environment', () => {
    for (const feature of ['http.ai', 'dev.debugControls', 'experiment.chemistry'] as const) {
      const decision = availability.require(feature, {
        environment: 'pilot',
        role: 'developer',
        devSurface: true
      });
      expect(decision.available).toBe(false);
      if (!decision.available) {
        expect(decision.reason).toBe('not-in-pilot');
      }
    }
  });

  it('applies role restrictions with a typed denial', () => {
    const decision = availability.require('tool.clearBoard', {
      environment: 'pilot',
      role: 'student'
    });
    expect(decision).toEqual({
      available: false,
      feature: 'tool.clearBoard',
      reason: 'role-not-allowed'
    });
  });

  it('fails closed on invalid environments and roles in require()', () => {
    expect(
      availability.require('tool.pen', { environment: 'staging' as any, role: 'teacher' })
    ).toEqual({ available: false, feature: 'tool.pen', reason: 'invalid-environment' });
    expect(
      availability.require('tool.pen', { environment: 'pilot', role: 'anonymous' as any })
    ).toEqual({ available: false, feature: 'tool.pen', reason: 'invalid-role' });
  });

  it('throws typed startup errors from resolve() on invalid input', () => {
    expect(() => availability.resolve({ environment: 'demo' as any, role: 'teacher' })).toThrow(
      PilotAvailabilityError
    );
    expect(() => availability.resolve({ environment: 'pilot', role: 'guest' as any })).toThrow(
      /Unknown role/
    );
  });

  it('is deterministic across repeated resolutions', () => {
    const first = availability.resolve({ environment: 'pilot', role: 'teacher' });
    const second = availability.resolve({ environment: 'pilot', role: 'teacher' });
    expect(first).toEqual(second);
  });

  it('enumerates the visible toolbar tools for UI enumeration tests', () => {
    const teacher = availability.resolve({ environment: 'pilot', role: 'teacher' });
    const student = availability.resolve({ environment: 'pilot', role: 'student' });
    expect(teacher.tools.map((tool) => tool.id)).toEqual([
      'tool.select',
      'tool.pan',
      'tool.pen',
      'tool.text',
      'tool.eraser',
      'tool.shapes',
      'tool.undo',
      'tool.redo',
      'tool.clearBoard',
      'panel.calculator',
      'panel.mathGraph',
      'panel.physicsGraph',
      'panel.coordinateSystem'
    ]);
    expect(student.tools.map((tool) => tool.id)).not.toContain('tool.clearBoard');
  });
});
