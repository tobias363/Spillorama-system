using System.Collections;
using System.Collections.Generic;
using UnityEngine.UI;
using TMPro;
using UnityEngine;
using System.Runtime.InteropServices.WindowsRuntime;

public class MysteryGameSelectionBall : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private GameObject ballPanel;
    [SerializeField] private TextMeshProUGUI textNumber;
    [SerializeField] private Image imageStatus;
    [SerializeField] private Image imageStatusLoading;

    private bool playLoaderAnimation = false;
    private Button button;

    public int turnCount;
    public bool isHigherNumber;

    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        button = this.gameObject.GetComponent<Button>();
        button.enabled = false;
    }

    private void Update()
    {
        if (playLoaderAnimation)
            imageStatusLoading.transform.Rotate(0, 0, -500 * Time.deltaTime);
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void Reset()
    {
        ballPanel.Close();
        textNumber.text = "";
        imageStatus.Close();
        imageStatusLoading.Close();
    }

    public void ValueValidation(int number, bool result, bool isJoker = false)
    {
        textNumber.text = isJoker == true ? "" : number.ToString();
        ballPanel.Open();
        Utility.Instance.ChangeScale(ballPanel.transform, Vector3.zero, Vector3.one, 0.5f);

        if (isJoker == true)
            return;

        StopAllCoroutines();
        StartCoroutine(PlayStatusAnimation());

        if (result)
            imageStatus.color = imageStatusLoading.color = Color.green;
        else
            imageStatus.color = imageStatusLoading.color = Color.red;
    }
    #endregion

    #region PRIVATE_METHODS
    IEnumerator PlayStatusAnimation()
    {
        imageStatusLoading.Open();
        playLoaderAnimation = true;
        yield return new WaitForSeconds(2);
        playLoaderAnimation = false;
        imageStatusLoading.Close();
        imageStatus.Open();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public bool ButtonEnable
    {
        set
        {
            if (button)
                button.enabled = value;
        }
    }
    #endregion
}
