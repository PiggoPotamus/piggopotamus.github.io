"""Decode Litematica and legacy MCEdit NBT into the shared schematic model."""
import json
from pathlib import Path
import schem_to_commands as core

# Selection gaps must remain untouched even when Include air is enabled.
UNSELECTED = '__unselected__'
MAX_VOLUME = 8_000_000
legacy_states = None
COLORS = ('white orange magenta light_blue yellow lime pink gray light_gray cyan purple blue brown green red black').split()


def dimensions(size):
    if min(size) <= 0:
        raise core.NBTError('Schematic dimensions must be positive.')
    if size[0] * size[1] * size[2] > MAX_VOLUME:
        raise core.NBTError('Selection is too large to convert in the browser. Save a smaller selection.')
    return size


def vector(value, label):
    if value is None:
        raise core.NBTError('Missing ' + label)
    value = core.compound(value, label)
    return tuple(core.int_value(value.get(axis), label + '.' + axis) for axis in ('x', 'y', 'z'))


def list_values(value, label):
    if value is None:
        return []
    if value.tag != core.TAG_LIST:
        raise core.NBTError(label + ' must be an NBT list.')
    return value.value[1]


def block_state(value):
    value = core.compound(value, 'BlockStatePalette entry')
    name = core.string_value(value.get('Name') or value.get('id'), 'BlockStatePalette.Name')
    props = value.get('Properties') or value.get('properties')
    if props is not None:
        props = core.compound(props, 'BlockStatePalette.Properties')
        if props:
            name += '[' + ','.join(k + '=' + core.string_value(v, k) for k, v in sorted(props.items())) + ']'
    return name


def tile_entity(value, pos):
    data = dict(core.compound(value, 'TileEntity'))
    tag = data.get('id') or data.get('Id')
    entity_id = core.string_value(tag, 'TileEntity.id') if tag else ''
    for key in ('x', 'y', 'z', 'Pos', 'id', 'Id'):
        data.pop(key, None)
    return core.BlockEntity(pos, entity_id, core.NBTValue(core.TAG_COMPOUND, data))


def load_litematic(root, progress=None):
    version = core.int_value(root.get('Version'), 'Version')
    if version not in (4, 5, 6, 7):
        raise core.NBTError(f'Unsupported Litematica version {version}; supported: 4–7.')
    regions = core.compound(root.get('Regions'), 'Regions') if root.get('Regions') else {}
    if not regions:
        raise core.NBTError('The Litematica file has no regions.')
    specs = []
    for name, value in regions.items():
        region = core.compound(value, 'Regions.' + name)
        pos = vector(region.get('Position'), name + '.Position')
        signed = vector(region.get('Size'), name + '.Size')
        size = dimensions(tuple(abs(n) for n in signed))
        low = tuple(p + min(0, n + 1) for p, n in zip(pos, signed))
        high = tuple(p + n - 1 for p, n in zip(low, size))
        specs.append((name, region, size, low, high))
    origin = tuple(min(r[3][a] for r in specs) for a in range(3))
    end = tuple(max(r[4][a] for r in specs) for a in range(3))
    width, height, length = dimensions(tuple(b - a + 1 for a, b in zip(origin, end)))
    blocks = [UNSELECTED] * (width * height * length)
    tiles = {}
    entities = 0
    for number, (name, region, size, low, _) in enumerate(specs, 1):
        if progress:
            progress(f'Decoding Litematica region {number}/{len(specs)}: {name}')
        palette = [block_state(v) for v in list_values(region.get('BlockStatePalette'), name + '.BlockStatePalette')]
        if not palette:
            raise core.NBTError(name + ' has an empty block palette.')
        states = region.get('BlockStates')
        if states is None or states.tag != core.TAG_LONG_ARRAY:
            raise core.NBTError(name + '.BlockStates must be a long array.')
        bits = max(2, (len(palette) - 1).bit_length())
        count = size[0] * size[1] * size[2]
        if len(states.value) * 64 < count * bits:
            raise core.NBTError(name + ' has truncated packed block data.')
        words = [n & ((1 << 64) - 1) for n in states.value]
        mask = (1 << bits) - 1
        ox, oy, oz = tuple(a - b for a, b in zip(low, origin))
        for i in range(count):
            bit = i * bits
            word, shift = divmod(bit, 64)
            value = words[word] >> shift
            if shift + bits > 64:
                value |= words[word + 1] << (64 - shift)
            index = value & mask
            if index >= len(palette):
                raise core.NBTError(name + ' refers to a missing palette entry.')
            x, z, y = i % size[0], (i // size[0]) % size[2], i // (size[0] * size[2])
            destination = (ox + x) + (oz + z) * width + (oy + y) * width * length
            blocks[destination] = palette[index]
            # A later region replaces an earlier region, including any old tile data.
            tiles.pop(destination, None)
        for value in list_values(region.get('TileEntities'), name + '.TileEntities'):
            raw = core.compound(value, 'TileEntity')
            local = tuple(core.int_value(raw.get(a), 'TileEntity.' + a) for a in ('x', 'y', 'z'))
            if any(p < 0 or p >= n for p, n in zip(local, size)):
                raise core.NBTError(name + ' has a block entity outside its region.')
            pos = tuple(p + o for p, o in zip(local, (ox, oy, oz)))
            key = pos[0] + pos[2] * width + pos[1] * width * length
            tiles[key] = tile_entity(value, pos)
        entities += len(list_values(region.get('Entities'), name + '.Entities'))
    meta = dict(core.compound(root['Metadata'], 'Metadata')) if root.get('Metadata') else {}
    data_version = core.int_value(root.get('MinecraftDataVersion'), 'MinecraftDataVersion') if root.get('MinecraftDataVersion') else -1
    selected = [tuple(v - origin[a % 3] for a, v in enumerate((*r[3], *r[4]))) for r in specs]
    return core.Schematic(version, data_version, width, height, length, blocks, list(tiles.values()), entities, meta, selected)


def load_legacy(root, progress=None):
    global legacy_states
    width, height, length = dimensions(tuple(core.int_value(root.get(k), k) for k in ('Width', 'Height', 'Length')))
    materials = root.get('Materials')
    if materials and core.string_value(materials, 'Materials') != 'Alpha':
        raise core.NBTError('Only Alpha-format legacy schematics are supported.')
    volume = width * height * length
    ids, data, adds = root.get('Blocks'), root.get('Data'), root.get('AddBlocks')
    for label, value in [('Blocks', ids), ('Data', data)]:
        if value is None or value.tag != core.TAG_BYTE_ARRAY or len(value.value) != volume:
            raise core.NBTError(label + ' must contain one byte per block.')
    if adds and (adds.tag != core.TAG_BYTE_ARRAY or len(adds.value) != (volume + 1) // 2):
        raise core.NBTError('AddBlocks contains an invalid number of bytes.')
    if legacy_states is None:
        with open(Path(__file__).with_name('legacy-states.json'), encoding='utf-8') as f:
            legacy_states = json.load(f)
    if progress:
        progress(f'Converting {volume:,} legacy block IDs to modern block states...')
    blocks = []
    used = {}
    for i, (block, meta) in enumerate(zip(ids.value, data.value)):
        block &= 255
        if adds:
            block |= ((adds.value[i // 2] >> (4 * (i % 2))) & 15) << 8
        key = (block << 4) | (meta & 15)
        if key not in used:
            state = legacy_states.get(str(key))
            if state is None:
                raise core.NBTError(f'Unsupported legacy block ID {block}:{meta & 15}. Modded numeric IDs need conversion to .schem first.')
            used[key] = state
        blocks.append(used[key])
    tiles = []
    for value in list_values(root.get('TileEntities'), 'TileEntities'):
        raw = core.compound(value, 'TileEntity')
        pos = tuple(core.int_value(raw.get(a), 'TileEntity.' + a) for a in ('x', 'y', 'z'))
        if any(p < 0 or p >= n for p, n in zip(pos, (width, height, length))):
            raise core.NBTError('Legacy block entity is outside the schematic.')
        index = pos[0] + pos[2] * width + pos[1] * width * length
        block_id = (ids.value[index] & 255) | ((((adds.value[index // 2] >> (4 * (index % 2))) & 15) << 8) if adds else 0)
        if block_id == 144:
            skull_type = core.int_value(raw['SkullType'], 'SkullType') if raw.get('SkullType') else 0
            heads = ['skeleton_skull', 'wither_skeleton_skull', 'zombie_head', 'player_head', 'creeper_head', 'dragon_head']
            if not 0 <= skull_type < len(heads):
                raise core.NBTError('Unsupported legacy skull type.')
            head = heads[skull_type]
            if '_wall_' in blocks[index]:
                head = head.replace('_skull', '_wall_skull').replace('_head', '_wall_head')
                props = blocks[index].split('[', 1)[1]
            else:
                rotation = core.int_value(raw['Rot'], 'Skull rotation') & 15 if raw.get('Rot') else 0
                props = f'rotation={rotation}]'
            blocks[index] = 'minecraft:' + head + '[' + props
        elif block_id in (176, 177) and raw.get('Base'):
            color = COLORS[15 - (core.int_value(raw['Base'], 'Banner.Base') & 15)]
            blocks[index] = blocks[index].replace('minecraft:white_', 'minecraft:' + color + '_', 1)
        elif block_id == 26 and raw.get('color'):
            color = COLORS[core.int_value(raw['color'], 'Bed.color') & 15]
            blocks[index] = blocks[index].replace('minecraft:red_bed', 'minecraft:' + color + '_bed', 1)
        tiles.append(tile_entity(value, pos))
    metadata = dict(core.compound(root['Metadata'], 'Metadata')) if root.get('Metadata') else {}
    for key in ('Name', 'Author', 'Description'):
        if root.get(key):
            metadata[key] = root[key]
    entities = len(list_values(root.get('Entities'), 'Entities'))
    return core.Schematic(0, 1343, width, height, length, blocks, tiles, entities, metadata)
