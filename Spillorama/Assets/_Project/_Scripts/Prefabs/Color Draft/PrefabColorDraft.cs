using System.Collections;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabColorDraft : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Images")]
    [SerializeField] private Image imgDoor;
    [SerializeField] private Image imgColor;

    [Header("Sprites")]
    [SerializeField] private Sprite SpriteCloseDoor;
    [SerializeField] private Sprite SpriteOpenDoor;


    [Header("Text")]
    [SerializeField] private Text txtDoorNumber;
    [SerializeField] private Text txtPrize;

    private ColorDraftPanel colorDraftPanel;

    [Header("Door No")]
    public int doorNo;

    [Header("Animator Holder")]
    [SerializeField] private Animator targetAnimator;

    Coroutine AnimatorCoroutine = null;

    #endregion

    #region UNITY_CALLBACKS


    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(ColorDraftPanel colorDraftPanel, int number)
    {
        this.colorDraftPanel = colorDraftPanel;
        imgColor.Close();
        txtPrize.text = "";
        txtDoorNumber.gameObject.SetActive(true);
        txtDoorNumber.text = number.ToString();
        doorNo = number;
        imgDoor.gameObject.GetComponent<Button>().interactable = true;
        targetAnimator.enabled = true;
        targetAnimator.SetBool("DoorOpen", false);
        imgDoor.sprite = SpriteCloseDoor;
    }

    public void TapOnDoor()
    {
        Debug.Log("TapOnDoor :" + this);
        colorDraftPanel.ColorDraftOpenFunction(this , doorNo);
    }

    public void OpenDoor(long prize , string color ,bool PlayAnim = true)
    {
        imgDoor.gameObject.GetComponent<Button>().interactable = false;
        imgColor.Open();
        txtDoorNumber.gameObject.SetActive(false);
        txtPrize.text = prize.ToString() + ",-";
        imgColor.color = colorDraftPanel.getcolor(color);

        if (PlayAnim)
        {
            targetAnimator.SetBool("DoorOpen", true);
            AnimatorCoroutine = StartCoroutine(WaitForAnimation());
        }
        else
        {
            targetAnimator.enabled = false;
            imgDoor.sprite = SpriteOpenDoor;
        }
           

    }

    private IEnumerator WaitForAnimation()
    {
        // Wait until the animation is complete
        while (!IsAnimationComplete())
        {
            yield return null;
        }

        Debug.Log("Animation Complete :" + this.gameObject.name);
        // Animation is complete
        // Code to execute when the animation is complete
    }

    private bool IsAnimationComplete()
    {
        return targetAnimator.GetCurrentAnimatorStateInfo(0).normalizedTime >= 1f;
    }

    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER

    #endregion
}
