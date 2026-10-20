"""Browser export/whole-file fitting around the original schematic converter."""
import glob
import os
import schem_to_commands as core


def convert(argv, max_bytes, formatter):
    max_bytes = int(max_bytes)
    if max_bytes < 1:
        raise ValueError('Max file size must be positive.')
    names = ('inspect_schematic_header', 'load_schematic', 'generate_commands', 'render_dynamic_item')
    original = {name: getattr(core, name) for name in names}
    old_limit = core.ITEM_FILL_PAYLOAD_LIMIT_BYTES
    cache = {}
    sizes = []

    def cached(name):
        def call(*args, **kwargs):
            if name not in cache:
                cache[name] = original[name](*args, **kwargs)
            return cache[name]
        return call

    for name in names[:3]:
        setattr(core, name, cached(name))

    def render(*args, **kwargs):
        text = str(formatter(original['render_dynamic_item'](*args, **kwargs))).rstrip('\n') + '\n'
        sizes.append(len(text.encode('utf-8')))
        return text

    core.render_dynamic_item = render
    payload_limit = max_bytes
    try:
        for attempt in range(8):
            for path in glob.glob(os.path.join(os.path.dirname(argv[1]), 'result*.txt')):
                os.remove(path)
            sizes.clear()
            core.ITEM_FILL_PAYLOAD_LIMIT_BYTES = payload_limit
            code = core.main(argv)
            if code:
                return code
            if sizes and max(sizes) <= max_bytes:
                return 0
            # Account for the complete loader, selected syntax and part labels,
            # not only the fill payload. Decoding and optimisation stay cached.
            overflow = max(sizes) - max_bytes
            payload_limit -= overflow + 256
            if payload_limit <= 0:
                raise ValueError('Max file size is too small for the loader. Increase it and try again.')
            print(f'Fitting whole files to {max_bytes:,} bytes; splitting into smaller items…', flush=True)
        raise ValueError('Could not fit the items. Increase Max file size.')
    finally:
        for name, function in original.items():
            setattr(core, name, function)
        core.ITEM_FILL_PAYLOAD_LIMIT_BYTES = old_limit
