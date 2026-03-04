using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
public class UIManager : MonoBehaviour
{
    public Button playBtn;
    public Button autoPlayBtn;
    
    public Button betUp;
    public Button betDown;

    public Button settingsBtn;
    public GameObject settingsPanel;
    public List<Button> settingsOption;
    public List<Button> autoSpinOptions;
    public List<GameObject> autoSpinBtnHighlighter;

    public List<Sprite> optionSelection;
    public List<Sprite> optionDeSelection;

    public int autoSpinCount = 5;

    private bool IsRealtimeMode()
    {
        return APIManager.instance != null && APIManager.instance.UseRealtimeBackend;
    }

    private void ApplyPlayButtonLabel()
    {
        if (playBtn == null)
        {
            return;
        }

        TMP_Text label = playBtn.GetComponentInChildren<TMP_Text>(true);
        if (label == null)
        {
            return;
        }

        label.text = IsRealtimeMode() ? "Plasser innsats" : "Play";
    }

    private bool IsProductionAutoPlayBlocked()
    {
        return !Application.isEditor && !Debug.isDebugBuild;
    }

    private void EnsurePlayButtonVisible()
    {
        if (playBtn == null)
        {
            return;
        }

        if (!playBtn.gameObject.activeSelf)
        {
            playBtn.gameObject.SetActive(true);
        }

        playBtn.interactable = true;
    }

    private static bool IsValidIndex<T>(List<T> list, int index)
    {
        return list != null && index >= 0 && index < list.Count;
    }

    private void ResetAutoSpinHighlights()
    {
        if (autoSpinBtnHighlighter == null)
        {
            return;
        }

        for (int i = 0; i < autoSpinBtnHighlighter.Count; i++)
        {
            if (autoSpinBtnHighlighter[i] != null)
            {
                autoSpinBtnHighlighter[i].SetActive(false);
            }
        }
    }

    private void OnEnable()
    {
        EventManager.OnAutoSpinOver += ActiveAllButtons;
        EnsurePlayButtonVisible();
        if (settingsPanel != null)
        {
            settingsPanel.SetActive(false);
        }

        if (IsValidIndex(settingsOption, 0) &&
            IsValidIndex(optionSelection, 0) &&
            IsValidIndex(optionDeSelection, 0))
        {
            SelectSettingsOption(0);
        }

        ApplyPlayButtonLabel();
        ResetAutoSpinHighlights();

        if (autoPlayBtn != null && IsProductionAutoPlayBlocked())
        {
            autoPlayBtn.interactable = false;
        }
    }

    private void OnDisable()
    {
        EventManager.OnAutoSpinOver -= ActiveAllButtons;
    }

    public void Play()
    {
        if (IsRealtimeMode())
        {
            if (playBtn != null)
            {
                playBtn.interactable = false;
            }

            APIManager.instance?.PlayRealtimeRound();
            Invoke(nameof(ActivePlayBtn), 0.5f);
            return;
        }

        if (playBtn != null)
        {
            playBtn.interactable = false;
        }

        if (EventManager.isPlayOver)
        {
            //Debug.Log("IsPlay Over : " + EventManager.isPlayOver);
            
            EventManager.AutoSpinStart(1);
            //ActiveAllButtons(false);  
        }
        else
        {
            
            EventManager.StartTimer();           
        }
        Invoke("ActivePlayBtn", 1);
        //EventManager.Play();
    }

    public void AutoSpin()
    {
        if (settingsPanel != null)
        {
            settingsPanel.SetActive(false);
        }

        if (IsValidIndex(settingsOption, 0) &&
            IsValidIndex(optionSelection, 0) &&
            IsValidIndex(optionDeSelection, 0))
        {
            SelectSettingsOption(0);
        }
    }

    public void StartAutoSpin()
    {
        if (IsProductionAutoPlayBlocked() && autoSpinCount > 1)
        {
            Debug.LogWarning("[UIManager] AutoSpin > 1 er deaktivert i production build.");
            return;
        }

        if (IsRealtimeMode())
        {
            APIManager.instance?.RequestRealtimeState();
            return;
        }

        EventManager.isAutoSpinStart = true;
        EventManager.AutoSpinStart(autoSpinCount);
        Debug.Log(autoSpinCount);
        //ActiveAllButtons(false);
    }

    public void Settings()
    {
        if (settingsPanel != null)
        {
            settingsPanel.SetActive(true);
        }
    }

    public void SelectSettingsOption(int index)
    {
        if (!IsValidIndex(settingsOption, index) ||
            !IsValidIndex(optionSelection, index) ||
            settingsOption[index] == null)
        {
            return;
        }

        Image selectedImage = settingsOption[index].GetComponent<Image>();
        if (selectedImage != null)
        {
            selectedImage.sprite = optionSelection[index];
        }

        for (int i = 0; i < settingsOption.Count; i++)
        {
            if (i != index &&
                IsValidIndex(optionDeSelection, i) &&
                settingsOption[i] != null)
            {
                Image image = settingsOption[i].GetComponent<Image>();
                if (image != null)
                {
                    image.sprite = optionDeSelection[i];
                }
            }
        }
    }

    public void ActivePlayBtn()
    {
        if (playBtn != null)
        {
            playBtn.interactable = true;
        }
    }

    public void AutoSpinOptionSelection(int index)
    {
        if (IsValidIndex(autoSpinBtnHighlighter, index) && autoSpinBtnHighlighter[index] != null)
        {
            autoSpinBtnHighlighter[index].SetActive(true);
            if (IsValidIndex(autoSpinOptions, index) && autoSpinOptions[index] != null)
            {
                Transform optionLabel = autoSpinOptions[index].transform.childCount > 0
                    ? autoSpinOptions[index].transform.GetChild(0)
                    : null;
                TextMeshProUGUI optionText = optionLabel != null ? optionLabel.GetComponent<TextMeshProUGUI>() : null;
                if (optionText != null && int.TryParse(optionText.text, out int parsedCount))
                {
                    autoSpinCount = parsedCount;
                }
            }
        }

        if (autoSpinOptions != null)
        {
            for (int i = 0; i < autoSpinOptions.Count; i++)
            {
                if (i != index && IsValidIndex(autoSpinBtnHighlighter, i) && autoSpinBtnHighlighter[i] != null)
                {
                    autoSpinBtnHighlighter[i].SetActive(false);
                }
            }
        }

        StartAutoSpin();
        if (settingsPanel != null)
        {
            Invoke(nameof(ClosePanel), 0.5f);
        }
    }

    public void ClosePanel()
    {
        if (settingsPanel != null)
        {
            settingsPanel.SetActive(false);
        }
    }


    public void ActiveAllButtons(bool isOver)
    {
        //playBtn.interactable = isOver;
        //autoPlayBtn.interactable = isOver;
        //settingsBtn.interactable = isOver;
        if (betUp != null)
        {
            betUp.interactable = isOver;
        }

        if (betDown != null)
        {
            betDown.interactable = isOver;
        }
    }
    
}
