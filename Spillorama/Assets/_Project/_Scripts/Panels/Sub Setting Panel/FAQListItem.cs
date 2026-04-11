using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public class FAQListItem : MonoBehaviour
{
    #region Public Variables
    public static EmptyDelegateEvent onAnswerButtonClicked;

    public GameObject answerObj;

    #endregion

    #region Private Variables
    [SerializeField] private TextMeshProUGUI question;
    [SerializeField] private TextMeshProUGUI answer;
    #endregion

    #region Public Methods
    public void SetData(FaqDetails faq)
    {
        //question.text = faq.question;
        //answer.text = faq.answer;


        question.text = Constants.LanguageKey.LoadingMessage;
        answer.text = Constants.LanguageKey.LoadingMessage;

        Utility.Instance.ForceTranslate(faq.question, "en-US", I2.Loc.LocalizationManager.CurrentLanguageCode, (string msg) =>
        {
            question.text = msg;
        });        
        
        
        Utility.Instance.ForceTranslate(faq.answer, "en-US", I2.Loc.LocalizationManager.CurrentLanguageCode, (string msg) =>
        {
            answer.text = msg;
        });

    }

    public void OnOpanAnswerButtonTap()
    {
        //Check weather the delegate is empty or not and invoke all the suscribe methods;
        onAnswerButtonClicked?.Invoke();
    }

    public void Open()
    {
        answerObj.SetActive(true);
        UIManager.Instance.subSettingPanel.faqPanel.RefreshPanel();
    }

    public void Close()
    {
        answerObj.SetActive(false);
        UIManager.Instance.subSettingPanel.faqPanel.RefreshPanel();
    }

    #endregion
}

public delegate void EmptyDelegateEvent();