using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabBingoBallPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES    
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private TextMeshProUGUI txtNumber;
    [SerializeField] private Image imgBall;
    [SerializeField] private bool isAnimationEnable = true;

    float tPosition;
    Vector3 startPosition;
    Vector3 targetPosition;
    float timeToReachTargetPosition;

    float tScale;
    Vector3 startScale;
    Vector3 targetScale;
    float timeToReachTargetScale;
    #endregion

    #region UNITY_CALLBACKS
    //void Update()
    //{
    //    if (isAnimationEnable)
    //    {
    //        tPosition += Time.deltaTime / timeToReachTargetPosition;
    //        transform.localPosition = Vector3.Lerp(startPosition, targetPosition, tPosition);

    //        tScale += Time.deltaTime / timeToReachTargetScale;
    //        transform.localScale = Vector3.Lerp(startScale, targetScale, tScale);
    //    }
    //}


    void Update()
    {
        if (isAnimationEnable)
        {
            if (timeToReachTargetPosition > 0)
            {
                tPosition += Time.deltaTime / timeToReachTargetPosition;
                tPosition = Mathf.Clamp01(tPosition);
                transform.localPosition = Vector3.Lerp(startPosition, targetPosition, tPosition);
            }

            if (timeToReachTargetScale > 0)
            {
                tScale += Time.deltaTime / timeToReachTargetScale;
                tScale = Mathf.Clamp01(tScale);
                transform.localScale = Vector3.Lerp(startScale, targetScale, tScale);
            }
        }
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(int number, Color32 ballColor, Color32 textColor)
    {
        txtNumber.text = number.ToString();
        txtNumber.color = textColor;
        imgBall.color = ballColor;
    }

    public void SetData(BingoNumberData data, string gameType)
    {
        txtNumber.text = data.number.ToString();
        switch (gameType)
        {
            case "Game 1":
                imgBall.sprite = Utility.Instance.GetGame1BallSprite(data.color);
                break;
            case "Game 2":
                imgBall.sprite = Utility.Instance.GetGame2BallSprite(data.color);
                break;
            default:
                imgBall.sprite = Utility.Instance.GetGame1BallSprite(data.color);
                break;
        }
    }    

    public void MoveObject(Vector3 toPosition, float time)
    {
        MoveObject(transform.localPosition, toPosition, time);
    }

    public void MoveObject(Vector3 fromPosition, Vector3 toPosition, float time)
    {
        tPosition = 0;
        startPosition = fromPosition;
        timeToReachTargetPosition = time;
        targetPosition = toPosition;

        transform.localPosition = fromPosition;

        if (!this.isActiveAndEnabled)
            this.Open();
    }

    public void ChangeScale(Vector3 toScale, float time)
    {
        ChangeScale(transform.localScale, toScale, time);
    }

    public void ChangeScale(Vector3 fromScale, Vector3 toScale, float time)
    {
        tScale = 0;
        startScale = fromScale;
        timeToReachTargetScale = time;
        targetScale = toScale;

        transform.localScale = fromScale;        
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}
