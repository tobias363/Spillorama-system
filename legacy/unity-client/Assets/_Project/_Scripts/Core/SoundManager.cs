using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class SoundManager : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public static SoundManager Instance = null;
    public static AISDelegateEvent OnSoundOptionChanged;
    public static AISDelegateEvent OnTvScreenSoundOptionChanged;
    public Sound[] sounds;
    public AudioClip[] bingoNumberAnnouncementAudioClip;

    public AudioClip[] NorwegianFemalebingoNumberAnnouncementAudioClip;
    public AudioClip[] NorwegianMalebingoNumberAnnouncementAudioClip;
    public AudioClip[] Game1NorwegianMalebingoNumberAnnouncementAudioClip;

    public bool IsAnnouncementPlaying => bingoNumberAnnouncementAudioSource.isPlaying;
    public bool IsBingoPlayed;
    #endregion

    #region PRIVATE_VARIABLES
    private AudioSource bingoNumberAnnouncementAudioSource;
    private AudioSource bingoSoundAudioSource;

    private Dictionary<int, bool> playedAnnouncements = new Dictionary<int, bool>();
    public Dictionary<string, bool> playedSoundTracker = new Dictionary<string, bool>();
    int AnnouncementNumber = 0;
    private int currentGameNumber = 1; // 1, 2, 3, or 4
    bool isEnglishAudio = false;
    bool AudioTwoTime = false;
    #endregion

    #region UNITY_CALLBACKS

    private void Awake()
    {
        if (Instance == null)
            Instance = this;
        else
        {
            Destroy(gameObject);
            return;
        }

        foreach (Sound s in sounds)
        {
            s.source = gameObject.AddComponent<AudioSource>();
            s.source.clip = s.clip;
            s.source.loop = s.loop;
            s.source.volume = s.volume;
        }

        bingoNumberAnnouncementAudioSource = gameObject.AddComponent<AudioSource>();
        bingoNumberAnnouncementAudioSource.playOnAwake = false;

        //SoundStatus = SoundStatus;
    }

    public void OnTap()
    {
        bingoNumberAnnouncementAudioSource.clip = bingoNumberAnnouncementAudioClip[0];
        bingoNumberAnnouncementAudioSource.volume = 0;
        bingoNumberAnnouncementAudioSource.Play();
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    private int GetActiveGameNumber()
    {
        if (UIManager.Instance.game1Panel != null && UIManager.Instance.game1Panel.isActiveAndEnabled)
            return 1;
        else if (UIManager.Instance.game2Panel != null && UIManager.Instance.game2Panel.isActiveAndEnabled)
            return 2;
        else if (UIManager.Instance.game3Panel != null && UIManager.Instance.game3Panel.isActiveAndEnabled)
            return 3;
        else if (UIManager.Instance.game4Panel != null && UIManager.Instance.game4Panel.isActiveAndEnabled)
            return 4;
        else if (UIManager.Instance.game5Panel != null && UIManager.Instance.game5Panel.isActiveAndEnabled)
            return 5;

        return 1; // Default to game 1
    }

    // Add a public method to play number announcement based on active game
    public void PlayNumberAnnouncementForActiveGame(int number, bool callTwoTime = false)
    {
        int activeGame = GetActiveGameNumber();

        switch (activeGame)
        {
            case 1:
                PlayNumberAnnouncement(number, callTwoTime);
                break;
            case 2:
                Debug.Log("PlayGame2NumberAnnouncement: " + number);
                PlayNorwegianMaleNumberAnnouncement(number, callTwoTime);
                break;
            case 3:
                PlayNorwegianMaleNumberAnnouncement(number, callTwoTime);
                break;
            case 4:
                PlayNorwegianMaleNumberAnnouncement(number, callTwoTime);
                break;
            case 5:
                PlayNorwegianMaleNumberAnnouncement(number, callTwoTime);
                break;
            default:
                PlayNumberAnnouncement(number, callTwoTime);
                break;
        }
    }
    public void PlayNumberAnnouncement(int announcementNumber, bool callTwoTime = false)
    {
        currentGameNumber = 1;
        AudioTwoTime = callTwoTime;
        isEnglishAudio = true;
        // Check if this number announcement has already been played.
        if (IsAnnouncementPlayed(announcementNumber))
            return;

        AnnouncementNumber = announcementNumber;
        MarkAnnouncementAsPlayed(announcementNumber);
        bingoNumberAnnouncementAudioSource.clip = bingoNumberAnnouncementAudioClip[
            announcementNumber - 1
        ];
        bingoNumberAnnouncementAudioSource.volume = 1;
        bingoNumberAnnouncementAudioSource.Play();

        if (callTwoTime)
        {
            // StopAllCoroutines();
            StartCoroutine(CallNumberSecondTime());
        }
    }


    public void PlayNorwegianFemaleNumberAnnouncement(
        int announcementNumber,
        bool callTwoTime = false
    )
    {
        isEnglishAudio = false;

        // Check if this number announcement has already been played.
        if (IsAnnouncementPlayed(announcementNumber))
            return;

        AnnouncementNumber = announcementNumber;
        MarkAnnouncementAsPlayed(announcementNumber);
        bingoNumberAnnouncementAudioSource.clip = NorwegianFemalebingoNumberAnnouncementAudioClip[
            announcementNumber - 1
        ];
        bingoNumberAnnouncementAudioSource.volume = 1;
        bingoNumberAnnouncementAudioSource.Play();
        if (callTwoTime)
        {
            // StopAllCoroutines();
            StartCoroutine(CallNumberSecondTime());
        }
    }

    public void PlayNorwegianMaleNumberAnnouncement(
        int announcementNumber,
        bool callTwoTime = false
    )
    {
        isEnglishAudio = false;

        // Check if this number announcement has already been played.
        if (IsAnnouncementPlayed(announcementNumber))
            return;

        AnnouncementNumber = announcementNumber;
        MarkAnnouncementAsPlayed(announcementNumber);
        bingoNumberAnnouncementAudioSource.clip = NorwegianMalebingoNumberAnnouncementAudioClip[
            announcementNumber - 1
        ];
        bingoNumberAnnouncementAudioSource.volume = 1;
        bingoNumberAnnouncementAudioSource.Play();
        if (callTwoTime)
        {
            // StopAllCoroutines();
            StartCoroutine(CallNumberSecondTime());
        }
    }
    public void Game1PlayNorwegianMaleNumberAnnouncement(
       int announcementNumber,
       bool callTwoTime = false
   )
    {
        isEnglishAudio = false;

        // Check if this number announcement has already been played.
        if (IsAnnouncementPlayed(announcementNumber))
            return;

        AnnouncementNumber = announcementNumber;
        MarkAnnouncementAsPlayed(announcementNumber);
        bingoNumberAnnouncementAudioSource.clip = Game1NorwegianMalebingoNumberAnnouncementAudioClip[
            announcementNumber - 1
        ];
        bingoNumberAnnouncementAudioSource.volume = 1;
        bingoNumberAnnouncementAudioSource.Play();
        if (callTwoTime)
        {
            // StopAllCoroutines();
            StartCoroutine(CallNumberSecondTime());
        }
    }

    IEnumerator CallNumberSecondTime()
    {
        yield return new WaitUntil(() => !bingoNumberAnnouncementAudioSource.isPlaying);
        yield return new WaitForSeconds(0.3f); //interval between second number announcement
        bingoNumberAnnouncementAudioSource.volume = 0.6f;
        // if (isEnglishAudio)
        // {
        //     bingoNumberAnnouncementAudioSource.clip = bingoNumberAnnouncementAudioClip[
        //         AnnouncementNumber - 1
        //     ];
        // }
        if (isEnglishAudio)
        {
            AudioClip[] clipArray = currentGameNumber switch
            {
                1 => bingoNumberAnnouncementAudioClip,
                2 => NorwegianMalebingoNumberAnnouncementAudioClip,
                3 => NorwegianMalebingoNumberAnnouncementAudioClip,
                4 => NorwegianMalebingoNumberAnnouncementAudioClip,
                5 => NorwegianMalebingoNumberAnnouncementAudioClip,
                _ => bingoNumberAnnouncementAudioClip
            };

            bingoNumberAnnouncementAudioSource.clip = clipArray[AnnouncementNumber - 1];
        }
        bingoNumberAnnouncementAudioSource.Play();

        AudioTwoTime = false;
    }

    public void StopNumberAnnouncement()
    {
        bingoNumberAnnouncementAudioSource.Stop();
    }

    public void MouseClick1()
    {
        Debug.Log("mouse click 1");
        Play("mouseClick1");
    }

    public void TicketNumberSelection()
    {
        Play("mouseClick2");
    }

    public void PlayNotificationSound()
    {
        Play("notification");
    }

    public void BingoSound(bool delay = false)
    {
        if (delay)
        {
            isBingo = true;
            Debug.Log("number announcement sound played");
            StartCoroutine(PlayBingoSound());
        }
        else
        {
            Debug.Log("bingo sound played");
            Play("bingo");
        }
    }
    #endregion
    bool isBingo = false;

    #region PRIVATE_METHODS
    private void Play(string name, bool play = true)
    {
        //Debug.Log("play sound");
        Sound s = Array.Find(sounds, sound => sound.name == name);

        if (play)
        {
            s.source.Play();
            // If the sound is "bingo", mark it as already played.
            if (name == "bingo")
            {
                Debug.LogError(name);
                Debug.LogError(playedSoundTracker.ContainsKey(name));
                // Set value to true, meaning it has been played.
                // If you need to check before playing again, you might consider:
                if (playedSoundTracker.ContainsKey(name))
                    playedSoundTracker[name] = true;
                else
                    playedSoundTracker.Add(name, true);
            }
            else
            {
                playedSoundTracker.Clear();
            }
        }
        else
        {
            s.source.Stop();
        }
    }
    #endregion

    #region COROUTINES
    public float delay;

    // IEnumerator PlayBingoSound()
    // {
    //     if (isEnglishAudio && AudioTwoTime)
    //     {
    //         Debug.LogError(
    //             $"English Two time : {AnnouncementNumber}  {bingoNumberAnnouncementAudioClip[AnnouncementNumber - 1].length + bingoNumberAnnouncementAudioClip[AnnouncementNumber - 1].length}"
    //         );
    //         if ((UIManager.Instance.bingoHallDisplayPanel != null && UIManager.Instance.bingoHallDisplayPanel.isButtonTap) || (UIManager.Instance.topBarPanel != null && UIManager.Instance.topBarPanel.isButtonTap))
    //         {
    //             Debug.LogError($"UIManager.Instance.bingoHallDisplayPanel.isButtonTap : {UIManager.Instance.bingoHallDisplayPanel?.isButtonTap} isBingo : {isBingo}");
    //             Debug.LogError($"UIManager.Instance.topBarPanel.isButtonTap : {UIManager.Instance.topBarPanel?.isButtonTap} isBingo : {isBingo}");
    //             yield return new WaitForSeconds(
    //                 bingoNumberAnnouncementAudioClip[AnnouncementNumber - 1].length
    //                     + bingoNumberAnnouncementAudioClip[AnnouncementNumber - 1].length
    //             );
    //             yield return new WaitUntil(() => !AudioTwoTime);
    //             yield return new WaitUntil(() => !bingoNumberAnnouncementAudioSource.isPlaying);
    //             yield return new WaitForSeconds(1f);
    //             Play("bingo");
    //             StopNumberAnnouncement();
    //             if (UIManager.Instance.bingoHallDisplayPanel != null)
    //                 UIManager.Instance.bingoHallDisplayPanel.isButtonTap = false;
    //             if (UIManager.Instance.topBarPanel != null)
    //                 UIManager.Instance.topBarPanel.isButtonTap = false;
    //         }
    //         else
    //         {
    //             Debug.LogError($"UIManager.Instance.bingoHallDisplayPanel.isButtonTap : {UIManager.Instance.bingoHallDisplayPanel?.isButtonTap} isBingo : {isBingo}");
    //             Debug.LogError($"UIManager.Instance.topBarPanel.isButtonTap : {UIManager.Instance.topBarPanel?.isButtonTap} isBingo : {isBingo}");
    //             yield return new WaitForSeconds(
    //                 bingoNumberAnnouncementAudioClip[AnnouncementNumber - 1].length
    //                     + bingoNumberAnnouncementAudioClip[AnnouncementNumber - 1].length
    //             );
    //             yield return new WaitUntil(() => !AudioTwoTime);
    //             yield return new WaitUntil(() => !bingoNumberAnnouncementAudioSource.isPlaying);
    //             yield return new WaitForSeconds(1f);
    //             Play("bingo");
    //             StopNumberAnnouncement();
    //             if (UIManager.Instance.bingoHallDisplayPanel != null)
    //                 UIManager.Instance.bingoHallDisplayPanel.isButtonTap = false;
    //             if (UIManager.Instance.topBarPanel != null)
    //                 UIManager.Instance.topBarPanel.isButtonTap = false;
    //         }
    //     }
    //     else
    //     {
    //         Debug.LogError($"else delay : {delay} number : {AnnouncementNumber} - {bingoNumberAnnouncementAudioClip[AnnouncementNumber - 1]}");
    //         if ((UIManager.Instance.bingoHallDisplayPanel != null && UIManager.Instance.bingoHallDisplayPanel.isButtonTap) || (UIManager.Instance.topBarPanel != null && UIManager.Instance.topBarPanel.isButtonTap))
    //         {
    //             Debug.LogError($"UIManager.Instance.bingoHallDisplayPanel.isButtonTap : {UIManager.Instance.bingoHallDisplayPanel?.isButtonTap} isBingo : {isBingo}");
    //             Debug.LogError($"UIManager.Instance.topBarPanel.isButtonTap : {UIManager.Instance.topBarPanel?.isButtonTap} isBingo : {isBingo}");
    //             yield return new WaitForSeconds(
    //                 bingoNumberAnnouncementAudioClip[AnnouncementNumber - 1].length
    //                     + bingoNumberAnnouncementAudioClip[AnnouncementNumber - 1].length
    //             );
    //             yield return new WaitUntil(() => !AudioTwoTime);
    //             yield return new WaitUntil(() => !bingoNumberAnnouncementAudioSource.isPlaying);
    //             yield return new WaitForSeconds(1f);
    //             Play("bingo");
    //             StopNumberAnnouncement();
    //             if (UIManager.Instance.bingoHallDisplayPanel != null)
    //                 UIManager.Instance.bingoHallDisplayPanel.isButtonTap = false;
    //             if (UIManager.Instance.topBarPanel != null)
    //                 UIManager.Instance.topBarPanel.isButtonTap = false;
    //         }
    //         else
    //         {
    //             yield return new WaitForSeconds(delay);
    //             yield return new WaitUntil(() => !bingoNumberAnnouncementAudioSource.isPlaying);
    //             yield return new WaitForSeconds(1f);
    //             Play("bingo");
    //             StopNumberAnnouncement();
    //         }
    //     }
    // }
    IEnumerator PlayBingoSound()
    {
        // Get the correct audio clip array based on current game
        AudioClip[] clipArray = currentGameNumber switch
        {
            1 => bingoNumberAnnouncementAudioClip,
            2 => NorwegianMalebingoNumberAnnouncementAudioClip,
            3 => NorwegianMalebingoNumberAnnouncementAudioClip,
            4 => NorwegianMalebingoNumberAnnouncementAudioClip,
            5 => NorwegianMalebingoNumberAnnouncementAudioClip,
            _ => bingoNumberAnnouncementAudioClip
        };

        if (isEnglishAudio && AudioTwoTime)
        {
            Debug.LogError(
                $"English Two time : {AnnouncementNumber}  {clipArray[AnnouncementNumber - 1].length + clipArray[AnnouncementNumber - 1].length}"
            );
            if ((UIManager.Instance.bingoHallDisplayPanel != null && UIManager.Instance.bingoHallDisplayPanel.isButtonTap) || (UIManager.Instance.topBarPanel != null && UIManager.Instance.topBarPanel.isButtonTap))
            {
                Debug.LogError($"UIManager.Instance.bingoHallDisplayPanel.isButtonTap : {UIManager.Instance.bingoHallDisplayPanel?.isButtonTap} isBingo : {isBingo}");
                Debug.LogError($"UIManager.Instance.topBarPanel.isButtonTap : {UIManager.Instance.topBarPanel?.isButtonTap} isBingo : {isBingo}");
                yield return new WaitForSeconds(
                    clipArray[AnnouncementNumber - 1].length
                        + clipArray[AnnouncementNumber - 1].length
                );
                yield return new WaitUntil(() => !AudioTwoTime);
                yield return new WaitUntil(() => !bingoNumberAnnouncementAudioSource.isPlaying);
                yield return new WaitForSeconds(1f);
                Play("bingo");
                StopNumberAnnouncement();
                if (UIManager.Instance.bingoHallDisplayPanel != null)
                    UIManager.Instance.bingoHallDisplayPanel.isButtonTap = false;
                if (UIManager.Instance.topBarPanel != null)
                    UIManager.Instance.topBarPanel.isButtonTap = false;
            }
            else
            {
                Debug.LogError($"UIManager.Instance.bingoHallDisplayPanel.isButtonTap : {UIManager.Instance.bingoHallDisplayPanel?.isButtonTap} isBingo : {isBingo}");
                Debug.LogError($"UIManager.Instance.topBarPanel.isButtonTap : {UIManager.Instance.topBarPanel?.isButtonTap} isBingo : {isBingo}");
                yield return new WaitForSeconds(
                    clipArray[AnnouncementNumber - 1].length
                        + clipArray[AnnouncementNumber - 1].length
                );
                yield return new WaitUntil(() => !AudioTwoTime);
                yield return new WaitUntil(() => !bingoNumberAnnouncementAudioSource.isPlaying);
                yield return new WaitForSeconds(1f);
                Play("bingo");
                StopNumberAnnouncement();
                if (UIManager.Instance.bingoHallDisplayPanel != null)
                    UIManager.Instance.bingoHallDisplayPanel.isButtonTap = false;
                if (UIManager.Instance.topBarPanel != null)
                    UIManager.Instance.topBarPanel.isButtonTap = false;
            }
        }
        else
        {
            // Debug.LogError($"else delay : {delay} number : {AnnouncementNumber} - {clipArray[AnnouncementNumber - 1]}");
            if ((UIManager.Instance.bingoHallDisplayPanel != null && UIManager.Instance.bingoHallDisplayPanel.isButtonTap) || (UIManager.Instance.topBarPanel != null && UIManager.Instance.topBarPanel.isButtonTap))
            {
                Debug.LogError($"UIManager.Instance.bingoHallDisplayPanel.isButtonTap : {UIManager.Instance.bingoHallDisplayPanel?.isButtonTap} isBingo : {isBingo}");
                Debug.LogError($"UIManager.Instance.topBarPanel.isButtonTap : {UIManager.Instance.topBarPanel?.isButtonTap} isBingo : {isBingo}");
                yield return new WaitForSeconds(
                    clipArray[AnnouncementNumber - 1].length
                        + clipArray[AnnouncementNumber - 1].length
                );
                yield return new WaitUntil(() => !AudioTwoTime);
                yield return new WaitUntil(() => !bingoNumberAnnouncementAudioSource.isPlaying);
                yield return new WaitForSeconds(1f);
                Play("bingo");
                StopNumberAnnouncement();
                if (UIManager.Instance.bingoHallDisplayPanel != null)
                    UIManager.Instance.bingoHallDisplayPanel.isButtonTap = false;
                if (UIManager.Instance.topBarPanel != null)
                    UIManager.Instance.topBarPanel.isButtonTap = false;
            }
            else
            {
                yield return new WaitForSeconds(delay);
                yield return new WaitUntil(() => !bingoNumberAnnouncementAudioSource.isPlaying);
                yield return new WaitForSeconds(1f);
                Play("bingo");
                StopNumberAnnouncement();
            }
        }
    }
    #endregion

    #region GETTER_SETTER
    public bool SoundStatus
    {
        set
        {
            PlayerPrefs.SetInt("SOUND_STATUS", value == true ? 1 : 0);

            foreach (Sound s in sounds)
            {
                s.source.mute = !value;
            }
            bingoNumberAnnouncementAudioSource.mute = !value;
            if (OnSoundOptionChanged != null)
                OnSoundOptionChanged.Invoke(value);
        }
        get { return PlayerPrefs.GetInt("SOUND_STATUS", 1) == 1; }
    }
    public void SetSoundStatus(bool isSoundOpen)
    {
        foreach (Sound s in sounds)
        {
            s.source.mute = !isSoundOpen;
        }
        bingoNumberAnnouncementAudioSource.mute = !isSoundOpen;
        if (OnSoundOptionChanged != null)
            OnSoundOptionChanged.Invoke(!isSoundOpen);

    }
    //public bool voiceStatus
    //{
    //    set
    //    {
    //        PlayerPrefs.SetInt("VOICE_STATUS", value == true ? 1 : 0);
    //        UIManager.Instance.gameAssetData.isVoiceOn = PlayerPrefs.GetInt("VOICE_STATUS", 1);
    //    }
    //    get
    //    {
    //        bool b = PlayerPrefs.GetInt("VOICE_STATUS", 1) == 1;
    //        UIManager.Instance.gameAssetData.isVoiceOn = PlayerPrefs.GetInt("VOICE_STATUS", 1);
    //        return b;

    //    }
    //}

    public bool TvScreenSoundStatus
    {
        set
        {
            PlayerPrefs.SetInt("TV_SCREEN_SOUND_STATUS", value == true ? 1 : 0);
            foreach (Sound s in sounds)
            {
                s.source.mute = !value;
            }
            bingoNumberAnnouncementAudioSource.mute = !value;
            if (OnTvScreenSoundOptionChanged != null)
            {
                OnTvScreenSoundOptionChanged.Invoke(value);
            }
        }
        get { return PlayerPrefs.GetInt("TV_SCREEN_SOUND_STATUS", 0) == 1; }
    }
    #endregion

    #region ANNOUNCEMENT_TRACKING
    private bool IsAnnouncementPlayed(int announcementNumber)
    {
        return playedAnnouncements.ContainsKey(announcementNumber)
            && playedAnnouncements[announcementNumber];
    }

    private void MarkAnnouncementAsPlayed(int announcementNumber)
    {
        if (!playedAnnouncements.ContainsKey(announcementNumber))
            playedAnnouncements.Add(announcementNumber, true);
        else
            playedAnnouncements[announcementNumber] = true;
    }

    public bool HasBingoBeenPlayed()
    {
        bool played = playedSoundTracker.TryGetValue("bingo", out played) && played;
        Debug.Log("HasBingoBeenPlayed() returns: " + played);
        return played;
    }

    // Call this method to reset the announcement status when needed (for example, at the start of a new round)
    public void ResetPlayedAnnouncements()
    {
        playedAnnouncements.Clear();
    }
    #endregion
}
