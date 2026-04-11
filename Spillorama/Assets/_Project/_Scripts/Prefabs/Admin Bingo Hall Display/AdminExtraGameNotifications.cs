using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

public class AdminExtraGameNotifications : MonoBehaviour
{
	#region PUBLIC_VARIABLES	
	[Header("Buttons")]
	[SerializeField] private Button btnOk;

	[Header("Texts")]
	[SerializeField] private TextMeshProUGUI txtTitle;
	[SerializeField] private TextMeshProUGUI txtMessage;
	[SerializeField] private TextMeshProUGUI txtWiners;

	Coroutine autoHide;

	#endregion

	#region PRIVATE_VARIABLES
	#endregion

	#region UNITY_CALLBACKS
	private void OnEnable()
	{
		btnOk.onClick.AddListener(HidePopup);
	}
	#endregion

	#region DELEGATE_CALLBACKS
	#endregion

	#region PUBLIC_METHODS

	public void DisplayPopup(string title,string message  , string winers, bool autoHide = false)
	{
		txtTitle.tag = title;
		txtMessage.text = message;
		txtWiners.text = winers;

		this.Open();
		if (autoHide)
			this.autoHide = StartCoroutine(AutoHideMessagePopUp());
	}

	IEnumerator AutoHideMessagePopUp()
	{
		yield return new WaitForSeconds(4f);
		if (autoHide != null)
		{
			this.Close();
			autoHide = null;
		}
	}

	public void OnCloseButtonTap()
	{
		gameObject.SetActive(false);
	}
	#endregion

	#region PRIVATE_METHODS
	private void HidePopup()
	{
		autoHide = null;
		this.Close();
	}
	#endregion

	#region COROUTINES
	#endregion
}
