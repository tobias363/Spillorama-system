# Audio Asset Export Guide — Game 1

## Required Files

AudioManager expects files at `backend/public/web/games/audio/`:

```
audio/
├── nb-m/          # Norwegian male (Game 1 specific)
│   ├── 1.mp3
│   ├── 2.mp3
│   └── ... (75 files, 1.mp3 through 75.mp3)
├── nb-f/          # Norwegian female
│   ├── 1.mp3
│   └── ... (75 files)
├── en/            # English
│   ├── 1.mp3
│   └── ... (75 files)
└── sfx/           # Sound effects
    ├── win.mp3    # Pattern won / prize
    ├── mark.mp3   # Number marked on ticket
    ├── draw.mp3   # Ball drawn
    ├── start.mp3  # Game start
    ├── end.mp3    # Game end
    └── spin.mp3   # Mini-game wheel spin
```

## Export from Unity

### Number announcements (225 files)

Unity stores these as AudioClip arrays on SoundManager:

| Array | Language | Web path |
|-------|----------|----------|
| `Game1NorwegianMalebingoNumberAnnouncementAudioClip` | Norwegian male (Game 1) | `nb-m/` |
| `NorwegianFemalebingoNumberAnnouncementAudioClip` | Norwegian female | `nb-f/` |
| `bingoNumberAnnouncementAudioClip` | English | `en/` |

Each array has 75 entries (index 0 = number 1, index 74 = number 75).

### Export steps

1. Open Unity project in Editor
2. Select `Managers/SoundManager` in hierarchy
3. For each AudioClip array:
   - Right-click each clip → Show in Explorer/Finder
   - Copy to `backend/public/web/games/audio/{lang}/`
   - Rename to `{number}.mp3` (1.mp3 through 75.mp3)
4. Alternatively, use CoPlay script:

```csharp
// Run via CoPlay execute_script
public class ExportAudio
{
    public static string Execute()
    {
        var sm = Object.FindObjectOfType<SoundManager>();
        var outputDir = "Assets/_Export/audio/";
        
        // Export each array
        ExportClips(sm.Game1NorwegianMalebingoNumberAnnouncementAudioClip, outputDir + "nb-m/");
        ExportClips(sm.NorwegianFemalebingoNumberAnnouncementAudioClip, outputDir + "nb-f/");
        ExportClips(sm.bingoNumberAnnouncementAudioClip, outputDir + "en/");
        
        return "Export complete";
    }
    
    static void ExportClips(AudioClip[] clips, string dir)
    {
        System.IO.Directory.CreateDirectory(dir);
        for (int i = 0; i < clips.Length; i++)
        {
            var path = dir + (i + 1) + ".mp3";
            // Note: Unity can't export to MP3 directly. Export as WAV 
            // then convert with ffmpeg: ffmpeg -i {n}.wav -codec:a libmp3lame -qscale:a 5 {n}.mp3
        }
    }
}
```

### TTS alternative

If original audio files are unavailable, generate with TTS:

```bash
# Norwegian (Azure TTS)
for i in $(seq 1 75); do
  az cognitiveservices account speech synthesize \
    --text "$i" --voice "nb-NO-FinnNeural" \
    --output "nb-m/$i.mp3"
done

# English
for i in $(seq 1 75); do
  az cognitiveservices account speech synthesize \
    --text "$i" --voice "en-US-GuyNeural" \
    --output "en/$i.mp3"
done
```

## AudioManager integration

Already implemented in `packages/game-client/src/audio/AudioManager.ts`:
- `playNumber(n)` — plays `{lang}/{n}.mp3`
- `playSfx("win")` — plays `sfx/win.mp3`
- `setLanguage("nb-m" | "nb-f" | "en")`
- `setMuted(true/false)`, `setVolume(0-1)`
- Lazy-loads audio on first use (no preload)
- Gracefully fails if file missing (no error shown to player)
