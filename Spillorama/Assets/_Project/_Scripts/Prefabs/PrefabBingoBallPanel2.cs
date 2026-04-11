using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabBingoBallPanel2 : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [SerializeField] private TextMeshProUGUI txtNumber;
    [SerializeField] private Image imgBall;
    [SerializeField] private Image imgHighlight;
    [SerializeField] private bool enableUpdate = false;

    float tPosition;
    Vector3 startPosition;
    Vector3 targetPosition;
    float timeToReachTargetPosition;

    private Vector3 _lastPosition = Vector3.zero;
    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS
    void Update()
    {
        if (enableUpdate)
        {
            tPosition += Time.deltaTime / timeToReachTargetPosition;
            transform.localPosition = Vector3.Lerp(startPosition, targetPosition, tPosition);
        }
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetBigBall(BingoNumberData data)
    {
        txtNumber.text = data.nextNumber.ToString();
        imgBall.sprite = Utility.Instance.GetGame2BallSprite(data.nextColor);
    }

    public void SetSmallBall(BingoNumberData data)
    {
        Debug.LogError(data.nextNumber);

        txtNumber.text = data.nextNumber.ToString();
        imgBall.sprite = Utility.Instance.GetGame2BallSprite(data.nextColor);
    }

    public void SetBigBallOnWin(BingoNumberData data)
    {
        txtNumber.text = data.number.ToString();
        imgBall.sprite = Utility.Instance.GetGame2BallSprite(data.color);
    }

    //OLD Code
    // public void SetData(BingoNumberData data)
    // {
    //     txtNumber.text = data.number.ToString();
    //     imgBall.sprite = Utility.Instance.GetGame2BallSprite(data.color);
    // }

    public void SetData(BingoNumberData data, BingoNumberData nextNumber, bool paused, bool isBigBall = false)
    {
        if (paused)
        {
            txtNumber.text = data.number.ToString();
            imgBall.sprite = Utility.Instance.GetGame2BallSprite(data.color);
        }
        else
        {
            if (data.number == 0 && data.color.Equals(null))
            {
                if (isBigBall)
                {
                    txtNumber.text = data.nextNumber.ToString();
                    imgBall.sprite = Utility.Instance.GetGame2BallSprite(data.nextColor);
                }
                else
                {
                    txtNumber.text = data.number.ToString();
                    imgBall.sprite = Utility.Instance.GetGame2BallSprite(data.color);
                }
            }
            else
            {
                if (nextNumber != null)
                {
                    if (isBigBall)
                    {
                        txtNumber.text = nextNumber.number.ToString();
                        imgBall.sprite = Utility.Instance.GetGame2BallSprite(nextNumber.color);
                    }
                    else
                    {
                        txtNumber.text = data.number.ToString();
                        imgBall.sprite = Utility.Instance.GetGame2BallSprite(data.color);
                    }
                }
                else
                {
                    if (!data.number.Equals(null) && !data.color.Equals(null))
                    {
                        if (data.totalWithdrawCount == 75)
                        {
                            txtNumber.text = data.number.ToString();
                            imgBall.sprite = Utility.Instance.GetGame2BallSprite(data.color);
                        }
                        else
                        {
                            txtNumber.text = data.nextNumber.ToString();
                            imgBall.sprite = Utility.Instance.GetGame2BallSprite(data.nextColor);
                        }
                    }
                    else
                    {
                        txtNumber.text = data.number.ToString();
                        imgBall.sprite = Utility.Instance.GetGame2BallSprite(data.color);
                    }
                }
            }
        }
    }

    public void MoveObject(Vector3 toPosition, float time)
    {
        MoveObject(transform.localPosition, toPosition, time);
    }

    public void MoveObject(Vector3 fromPosition, Vector3 toPosition, float time)
    {
        LastPosition = toPosition;

        if (time == 0)
        {
            enableUpdate = false;
            transform.localPosition = toPosition;
        }
        else
        {
            tPosition = 0;
            startPosition = fromPosition;
            timeToReachTargetPosition = time;
            targetPosition = toPosition;
            transform.localPosition = fromPosition;

            enableUpdate = true;
        }

        if (!this.isActiveAndEnabled)
            this.Open();
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public bool Highlight
    {
        set
        {
            if (value)
            {
                imgHighlight.CrossFadeAlpha(1, 0, true);
                imgHighlight.gameObject.SetActive(true);
            }
            else
            {
                imgHighlight.CrossFadeAlpha(0, 1, true);
            }
        }
    }

    public Vector3 LastPosition
    {
        set
        {
            _lastPosition = value;
        }
        get
        {
            return _lastPosition;
        }
    }
    #endregion
}
