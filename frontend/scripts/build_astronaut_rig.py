# Gera public/models/astronaut-rig.glb para o jogo (Blender, sem interface):
#
#   blender -b --factory-startup -P scripts/build_astronaut_rig.py
#
# Entrada: as FBX do Mixamo em ../animações (o astronauta oficial, riggado no
# Mixamo). Os arquivos originais não são alterados.
#
# - Malha e esqueleto vêm de Floating.fbx.
# - Correção do rig: o auto-rig do Mixamo espalhou ~22% dos vértices do capacete
#   entre Neck/Spine2/RightShoulder, e o capacete esticava quando o tronco mexia.
#   Aqui o capacete passa a seguir 100% o osso Head, com uma faixa curta de
#   transição no colar (deformação do capacete medida: ~9–21% -> 0%).
# - Cada FBX vira um clipe nomeado (idle, fly, impact). O deslocamento horizontal
#   dos quadris é removido (o jogo controla a posição); o vertical fica.
# - Texturas reduzidas para 1024 px em WebP.

import bpy
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(ROOT, 'animações')
OUT = os.path.join(ROOT, 'frontend', 'public', 'models', 'astronaut-rig.glb')

BASE = 'Floating.fbx'
CLIPS = {
    'idle': ('Floating.fbx', True),
    'fly': ('Flying.fbx', True),
    'impact': ('Falling Flat Impact.fbx', False),  # cai no chão: mantém o movimento dos quadris
}
TEX_SIZE = 1024


def log(*a):
    print('[rig]', *a)
    sys.stdout.flush()


def import_fbx(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, name))
    return [o for o in bpy.data.objects if o not in before]


def fix_helmet_weights(arm, mesh):
    head_z = (arm.matrix_world @ arm.data.bones['mixamorig:Head'].head_local).z
    lo, hi = head_z - 0.015, head_z + 0.01
    head = mesh.vertex_groups['mixamorig:Head']
    changed = 0
    for v in mesh.data.vertices:
        z = (mesh.matrix_world @ v.co).z
        if z < lo:
            continue
        t = 1.0 if z >= hi else (z - lo) / (hi - lo)
        for g in list(v.groups):
            if g.group != head.index:
                mesh.vertex_groups[g.group].add([v.index], g.weight * (1 - t), 'REPLACE')
        cur = next((g.weight for g in v.groups if g.group == head.index), 0.0)
        head.add([v.index], cur + (1 - cur) * t, 'REPLACE')
        changed += 1
    for v in mesh.data.vertices:
        s = sum(g.weight for g in v.groups)
        if s > 0:
            for g in v.groups:
                g.weight /= s
    log(f'capacete: {changed} vértices presos ao Head (pescoço em z={head_z:.3f})')


def channelbag_fcurves(action):
    """F-curves da ação (Blender 4.4+ guarda por slot; versões antigas em action.fcurves)."""
    if hasattr(action, 'layers') and action.layers:
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out.extend(bag.fcurves)
        return out
    return list(action.fcurves)


def strip_root_motion(action):
    """Zera X/Z (horizontal no Mixamo, Y-up) da posição dos quadris, mantendo o 1º quadro."""
    n = 0
    for fc in channelbag_fcurves(action):
        if fc.data_path == 'pose.bones["mixamorig:Hips"].location' and fc.array_index in (0, 2):
            first = fc.keyframe_points[0].co[1] if fc.keyframe_points else 0.0
            for k in fc.keyframe_points:
                k.co[1] = first
                k.handle_left[1] = first
                k.handle_right[1] = first
            n += 1
    return n


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = import_fbx(BASE)
    arm = next(o for o in objs if o.type == 'ARMATURE')
    mesh = next(o for o in objs if o.type == 'MESH')
    arm.name = 'Astronaut'
    mesh.name = 'AstronautMesh'
    fix_helmet_weights(arm, mesh)

    # A ação que veio junto com a malha base é descartada; os clipes são importados à parte.
    base_action = arm.animation_data.action if arm.animation_data else None

    actions = {}
    for clip, (fname, strip) in CLIPS.items():
        new = import_fbx(fname)
        src_arm = next(o for o in new if o.type == 'ARMATURE')
        act = src_arm.animation_data.action
        act.name = clip
        act.use_fake_user = True
        if strip:
            log(f'{clip}: {strip_root_motion(act)} canais de deslocamento removidos')
        r = act.frame_range
        log(f'{clip}: quadros {r[0]:.0f}-{r[1]:.0f}')
        actions[clip] = act
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)

    if base_action and base_action.name not in actions:
        bpy.data.actions.remove(base_action)

    # Uma faixa NLA por clipe: o exportador glTF gera uma animação por faixa.
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = None
    for clip, act in actions.items():
        track = ad.nla_tracks.new()
        track.name = clip
        s = track.strips.new(clip, int(act.frame_range[0]), act)
        s.name = clip
        track.mute = False

    # Texturas: 1024 px.
    for img in bpy.data.images:
        if img.size[0] > TEX_SIZE:
            img.scale(TEX_SIZE, TEX_SIZE * img.size[1] // img.size[0])
            log(f'textura {img.name}: {img.size[0]}x{img.size[1]}')

    # Remove sobras (armaduras/malhas importadas que não são o personagem).
    for o in list(bpy.data.objects):
        if o not in (arm, mesh):
            bpy.data.objects.remove(o, do_unlink=True)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        export_image_format='WEBP',
        export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,
        export_frame_step=1,
        export_optimize_animation_size=True,
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )
    log(f'exportado: {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB)')


main()
