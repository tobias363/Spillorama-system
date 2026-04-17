using I2.Loc;
using TMPro;
using UnityEngine;

public class PrefabJackpotPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES    
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtType;
    [SerializeField] private TextMeshProUGUI txtNumber;
    [SerializeField] private TextMeshProUGUI txtPrize;

    [Header("Transform")]
    [SerializeField] private Transform transformContainer;

    public CanvasGroup Jackpot_CG;
    public GameObject Number_Container;

    internal JackpotData data;
    int number = 0;
    float animationTime = 1.5f;

    float t;
    Vector3 fromRotation;
    Vector3 toRotation;
    float timeToReachTarget;
    #endregion

    #region UNITY_CALLBACKS
    void Update()
    {
        if (t < 1)
        {
            t += Time.deltaTime / timeToReachTarget;
            transformContainer.eulerAngles = Vector3.Lerp(fromRotation, toRotation, t);
        }
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(JackpotData data)
    {
        this.data = data;
        txtType.text = LocalizationManager.GetTranslation(data.type.Equals("jackpot") ? "Jackpot" : "gain");
        txtNumber.text = data.number;
        txtPrize.text = data.prize.ToString();
        Jackpot_CG.alpha = 1f;
        Number_Container.transform.localScale = Vector3.one;
    }

    public void PlayJackpotAnimation()
    {
        //Utility.Instance.RotateObject(transformContainer, Vector3.zero, new Vector3(0, 0, -360), animationTime);
        RotateObject(Vector3.zero, new Vector3(0, 0, -360), animationTime);
        LeanTween.scale(Number_Container, Vector3.one * 1.1f, 0.5f);
        SoundManager.Instance.PlayNotificationSound();
    }
    #endregion

    #region PRIVATE_METHODS
    public void RotateObject(Vector3 fromRotation, Vector3 toRotation, float time)
    {
        t = 0;
        this.fromRotation = fromRotation;
        timeToReachTarget = time;
        this.toRotation = toRotation;
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public int Number
    {
        get
        {            
            if(int.TryParse(data.number, out number))
                return number;
            else
                return 0;
        }
    }

    public string Type
    {
        get
        {
            return data.type.ToLower();
        }
    }
    #endregion
}
