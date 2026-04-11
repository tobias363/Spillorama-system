using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ScreenshotManager : MonoBehaviour {

	public string ssName = "apple";
	public int index = 1;

	#if UNITY_EDITOR
	void Update()
	{
		if (Input.GetKeyDown (KeyCode.Space)) {
			ScreenCapture.CaptureScreenshot (ssName + index + ".png");
			print (ssName + index + ".png");
		}
	}
	#endif
}
