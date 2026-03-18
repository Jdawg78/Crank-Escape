# Custom Sounds

Upload your custom sound effects to this folder.

Name them exactly as follows for the game to pick them up automatically:
- `crank.mp3` (Played when turning the crank)
- `buy.mp3` (Played when buying an upgrade)
- `goal.mp3` (Played when reaching 1,000,000 revolutions)

Supported formats: `.mp3`, `.wav`, `.ogg` (just make sure to rename the extension in `src/app/audio.service.ts` if you use something other than `.mp3`).
