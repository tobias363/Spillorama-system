using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

public class Game5BetCoin : MonoBehaviour , IEndDragHandler , IDragHandler
{
    [SerializeField] private Canvas canvas;
    public bool isOnTicket = false;
    public int chipValue = 0;
    private Vector2 chipInitRectTransform;
    private RectTransform rectTransform;

    private CanvasGroup canvasGroup;

    private void OnEnable()
    {
        ResetChip();
    }

    private void Awake()
    {
        chipInitRectTransform = GetComponent<RectTransform>().anchoredPosition;
        rectTransform = GetComponent<RectTransform>();
        canvasGroup = GetComponent<CanvasGroup>();
    }


    public void OnDrag(PointerEventData eventData)
    {
        if (UIManager.Instance.game5Panel.game5GamePlayPanel.IsGamePlayInProcess)
            return;

        rectTransform.anchoredPosition += eventData.delta / canvas.scaleFactor;
        canvasGroup.alpha = 0.6f;
        canvasGroup.blocksRaycasts = false;
    }

    public void OnEndDrag(PointerEventData eventData)
    {
        if (UIManager.Instance.game5Panel.game5GamePlayPanel.IsGamePlayInProcess) return;

        LeanTween.cancel(rectTransform);

        if (!isOnTicket)
        {
            try
            {
                LeanTween.move(rectTransform, chipInitRectTransform, 0.5f)
                .setEase(LeanTweenType.easeOutQuad)
                .setOnComplete(() => ResetChip());
            }
            catch (System.Exception ex)
            {
                Debug.LogError("1 Error during LeanTween animation: " + ex.Message);
            }      
        }
        else
        {
            try
            {
                canvasGroup.alpha = 1f;
                LeanTween.scale(rectTransform, Vector3.one * 2.0f, 0.3f)
                    .setEase(LeanTweenType.easeOutQuad)
                    .setOnComplete(() =>
                    {
                        LeanTween.scale(rectTransform, Vector3.one, 0.2f)
                            .setEase(LeanTweenType.easeOutQuad)
                            .setOnComplete(ResetChip);
                    });
            }
            catch (System.Exception ex)
            {
                Debug.LogError("2 Error during LeanTween animation: " + ex.Message);
            }
        }
    }

    void ResetChip()
    {
        try
        {
            LeanTween.move(rectTransform, chipInitRectTransform, isOnTicket ? 0f : 0.5f)
           .setEase(LeanTweenType.easeOutQuad)
           .setOnComplete(() =>
           {
               canvasGroup.blocksRaycasts = true;
               if (!isOnTicket) canvasGroup.alpha = 1f;
               isOnTicket = false;
           });
        }
        catch (System.Exception ex)
        {
            Debug.LogError("3 Error during LeanTween animation: " + ex.Message);
        }
    }
}
