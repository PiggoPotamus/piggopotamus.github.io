[**Open the converters — piggopotamus.github.io**](https://piggopotamus.github.io)

# Piggo’s Minecraft converters

Convert schematics, images and GIFs into items for Minecraft Java Edition.
Conversion happens in your browser; your files are not uploaded.

- **Images/GIFs:** turn an image, GIF or video into a display item for MID.
- **Schematics:** turn a `.schem`, `.litematic` or legacy `.schematic` file into an item that previews and builds it.
- **Music:** coming soon.

## Images and GIFs

**MID stands for Minecraft Image Display.** It is a command-block engine that
shows images and plays GIFs in your world.

1. Open Images/GIFs and expand **Download the MID engine**.
2. Download and import the engine item, then **place the engine first**. You need
   creative mode and permission to run command blocks. Install it once per world.
3. Choose your image, GIF or video. Adjust the settings and select **Convert**.
4. Compare the source and converted preview, then download and import your image item.
5. Place the image item in your world.

Use **Item name** under Export to replace the source filename in the item’s name.
Leave it blank to keep the filename. The [MID] prefix remains. You can rename
a converted item without converting the pixels again.

Choose **Compact** for a smaller item that takes longer to load in-game, or
**Fast** for a bigger item that loads faster initially. The defaults are 600 KB max item
size and 16,000 pixels per frame. More than 20,000 pixels per frame may lower
FPS. Very large items may be refused by the server or cause a kick.

**Conversion quality** is the last main conversion setting and defaults to
**Medium**, using the previous build's quicker six-pass palette refinement and
first-fit search. **Low (faster)** uses the original coarse colour mapping.
**High (slower)** uses two palette seeds, up to 12 refinement passes and a bounded
palette/resolution/pattern search. **Very high (slowest)** retains the deepest
three-seed, 24-pass search and broader resolution trials from build 10.
Medium and above use bicubic Smooth resizing and exact pixel colour matching.
Pixel art never blends pixels. All levels obey item-size and per-frame pixel
limits and preserve animation frames. Quality changes conversion time, not GIF
playback speed. Changing quality requires converting again.

For Compact items, High and Very high also search repeated pieces inside rows,
not just complete rows. It tests dictionary sizes up to 128 patterns, finds the
smallest combination of literal letters and pattern references, and removes
unhelpful entries. Only measured reductions in complete encoded data are kept.
This compression is lossless and uses the existing engine format. Detailed GIFs
can take substantially longer; exact-colour or simple images can still finish
quickly because there is less useful work to do.

Leave the colour target blank to choose automatically, or enter 2–256 colours.
Smaller colour, pixel or item-size limits may reduce detail. Frame cap, dithering
and resize filter are under Advanced settings. GIFs play in the source preview
before conversion. Video and animated-image support depends on your browser.
The converted preview shows the pixels; Minecraft’s font can look different.

## Getting items into Minecraft

The image converter, schematic converter and engine download offer the same formats:

- **SNBT (Item Editor Mod):** recommended. Import the SNBT with
  [Item Editor by noramibu](https://modrinth.com/mod/item-editor) in creative mode.
- **.give (Meteor Client command):** for your Meteor Client item-command workflow.
- **/give (may be too long for command blocks):** a normal give command.
- **Datapack (.zip):** enter your Minecraft Java username. Put the ZIP in your
  world’s `datapacks` folder and run `/reload`, or reopen the world. All items go
  only to that player, once, on joining or immediately if already online. You
  need access to the world files to install it. After delivery it stops checking
  for players. Rejoining, reloading or reinstalling the same export does not
  give the items again. Datapack metadata supports Java 1.21.11 through 26.3.

A datapack delivers the **item**. You still need to place it in Minecraft.
For MID, place the engine item before any image items.

## Schematics

Choose a Sponge / WorldEdit `.schem`, Litematica `.litematic` or legacy
MCEdit / WorldEdit `.schematic` file and convert it. Import and
place the item to see the build preview, then use its dialog to build. The default speed in the build dialog is 400 fills per tick.

Max file size defaults to 600 KB per item. Larger builds are split into several
items; a datapack ZIP includes all parts. The size limit applies to each item’s
give command, not the combined ZIP. Include air if you want empty areas cleared.
Extra compatibility keeps all saved block settings but does not fix renamed blocks.
Non-block entities are not included in schematic builds.

Litematica regions retain their spacing, including selections with negative
sizes. Include air clears selected regions without clearing the gaps between
them. Legacy vanilla numeric block IDs and metadata become modern block states.
Modded numeric IDs need conversion to .schem using the original mod first.
Saved block-entity NBT is preserved; old item/entity data is not fully upgraded
between game versions. New-format selections are limited to 8 million blocks
in their enclosing area. Conversion details show any warnings.

Build: 2026-10-20.13
