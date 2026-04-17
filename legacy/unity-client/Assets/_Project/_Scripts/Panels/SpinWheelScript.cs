//using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using Assets.Plugins.Drop3DEffects.Scripts;
using TMPro;
using UnityEngine;
using UnityEngine.Events;

public class SpinWheelScript : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public float rSpeed = 10;
    public float rMultiplier = 0.96f;

    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private Transform transformWheel;
    [SerializeField] private List<long> prizeList;

    [SerializeField] private GameObject prefabPrizePanel;
    [SerializeField] private Transform transformContainer;

    [SerializeField] private float rotationSpeed = 0;
    private bool isSpinInProcess = false;

    private bool isSpinning = false;
    public bool stopReceived = false;

    private float targetRotationZ;
    private long stopPrize;
    #endregion

    #region CUSTOM_UNITY_ACTION
    public UnityEvent unityEventSpinWheelStop;
    #endregion

    #region UNITY_CALLBACKS

    /*[SerializeField] private GameObject prefabPoint;
    [SerializeField] private Transform transformContainer;
    private void Awake()
    {
        float pos1 = 3.6f;
        float diff = 7.2f;

        for (int i = 1; i <= 50; i++)
        {
            GameObject newObject = Instantiate(prefabPoint, transformContainer);

            newObject.transform.eulerAngles = new Vector3(0, 0, pos1);
            newObject.name = "Point " + i;
            newObject.SetActive(true);

            pos1 -= diff;
        }
    }*/

    //private void Awake()
    //{
    //    float zRotation = -3.6f;
    //    float rotationDifference = 7.2f;

    //    for (int i = 0; i < 50; i++)
    //    {
    //        GameObject newObject = Instantiate(prefabPrizePanel, transformContainer);

    //        newObject.transform.eulerAngles = new Vector3(0, 0, zRotation);            
    //        newObject.SetActive(true);
    //        newObject.transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = prizeList[i].ToString();

    //        zRotation -= rotationDifference;
    //    }
    //}

    private void Start()
    {
        SetData(prizeList);
    }
    private void Update()
    {
        transformWheel.Rotate(0, 0, rotationSpeed);
        // old rotation code
        rotationSpeed *= rMultiplier;
        if (isSpinInProcess && rotationSpeed > -0.005f)
        {
            rotationSpeed = 0;
            isSpinInProcess = false;
            unityEventSpinWheelStop.Invoke();
            UIManager.Instance.game1Panel.game1GamePlayPanel.wheelOfFortunePanel.WinningAnimation();

            // stopReceived = false;
        }

        if (Input.GetKeyDown(KeyCode.V))
        {
            StopSpinWheelBroadcast(1000);
        }
        if (Input.GetKeyDown(KeyCode.B))
        {
            StartCoroutine(CheckWheelStop());
            SpinTheWheel(1000);
        }

        // Gradual deceleration
        // float currentRotationSpeed = 0;
        // if (stopReceived)
        // {
        //     // Calculate the difference between the current angle and target angle
        //     float currentAngle = transformWheel.eulerAngles.z;
        //     float angleDiff = Mathf.DeltaAngle(currentAngle, targetRotationZ);

        //     Debug.Log($"Current Rotation: {currentAngle}, Target Rotation: {targetRotationZ}, Angle Diff: {angleDiff}");

        //     // Check if we are close enough to the target to stop
        //     if (Mathf.Abs(angleDiff) <= 1.0f && Mathf.Abs(rotationSpeed) <= 0.1f)
        //     {
        //         // Stop the wheel gradually
        //         rotationSpeed = 0f;
        //         isSpinInProcess = false;
        //         stopReceived = false;

        //         Debug.Log("Spin stopped at the desired prize!");

        //         // Trigger prize-winning logic
        //         // unityEventSpinWheelStop.Invoke();
        //         // UIManager.Instance.game1Panel.game1GamePlayPanel.WheelOfFortunePanel.WinningAnimation();
        //     }
        //     else
        //     {
        //         // Gradually decelerate the wheel
        //         float decelerationFactor = CalculateDecelerationFactor(angleDiff);
        //         rotationSpeed = Mathf.Lerp(rotationSpeed, 0f, decelerationFactor * Time.deltaTime);

        //         Debug.Log($"Decelerating Speed: {rotationSpeed}, Angle Diff: {angleDiff}");
        //     }
        // }
    }

    private float CalculateDecelerationFactor(float angleDiff)
    {
        // Normalize the angle difference (closer angles decelerate faster)
        float angleFactor = Mathf.InverseLerp(0f, 180f, Mathf.Abs(angleDiff));

        // Normalize the current rotation speed
        float speedFactor = Mathf.InverseLerp(0f, 100f, Mathf.Abs(rotationSpeed));

        // Blend the deceleration factors for smoothness
        float smoothingFactor = Mathf.Lerp(0.05f, 0.5f, angleFactor);  // Closer angles decelerate faster
        float speedReduction = Mathf.Lerp(0.05f, 0.5f, speedFactor);   // Higher speeds require stronger deceleration

        // Combine the smoothing factors for realistic deceleration
        return Mathf.Lerp(smoothingFactor, speedReduction, 0.5f);
    }


    private void OnDisable()
    {
        rotationSpeed = 0;
        isSpinInProcess = false;
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(List<long> prizeList)
    {
        this.prizeList = prizeList;

        float zRotation = -3.6f;
        float rotationDifference = 7.2f;
        transformContainer.localEulerAngles = Vector3.zero;

        foreach (Transform tObj in transformContainer)
            Destroy(tObj.gameObject);

        for (int i = 0; i < 50; i++)
        {
            GameObject newObject = Instantiate(prefabPrizePanel, transformContainer);

            newObject.transform.eulerAngles = new Vector3(0, 0, zRotation);
            newObject.SetActive(true);
            newObject.transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = prizeList[i].ToString() + " kr";

            zRotation -= rotationDifference;
        }
    }

    public void SpinTheWheel(long desiredPrize)
    {
        if (!isPrizeExists(desiredPrize))
            return;

        float desiredRotationZ = GetDesiredRotationZ(desiredPrize);
        Debug.LogError(message: "desiredRotationZ : " + desiredRotationZ);
        float newRotationValue = Random.Range(desiredRotationZ - 3.25f, desiredRotationZ + 3.25f);
        Debug.LogError("newRotationValue : " + newRotationValue);

        transformWheel.eulerAngles = new Vector3(0, 0, newRotationValue - 80);
        rotationSpeed = rSpeed;
        isSpinInProcess = true;
        stopReceived = false;
    }

    public void SetWheelToPrize(long desiredPrize)
    {
        if (!isPrizeExists(desiredPrize))
        {
            Debug.LogError("Prize does not exist: " + desiredPrize);
            return;
        }

        // Calculate the exact rotation for the desired prize
        float desiredRotationZ = GetDesiredRotationZ(desiredPrize);

        Debug.Log($"Setting wheel directly to desired prize. Rotation: {desiredRotationZ}");

        // Directly set the wheel's rotation
        transformWheel.eulerAngles = new Vector3(0, 0, desiredRotationZ);

        // Reset rotationSpeed and related flags
        rotationSpeed = 0;
        isSpinInProcess = false;
    }

    public void StopSpinWheelBroadcast(long desiredPrize)
    {
        if (!isPrizeExists(desiredPrize)) return;

        rMultiplier = 0.33f;
        // Randomize rotation around the desired prize
        float desiredRotationZ = GetDesiredRotationZ(desiredPrize);
        targetRotationZ = Random.Range(desiredRotationZ - 3.25f, desiredRotationZ + 3.25f);
        Debug.LogError($"Broadcast received. desiredRotationZ: {desiredRotationZ}");
        Debug.LogError($"Broadcast received. Target Angle: {targetRotationZ}");

        // Start spin deceleration
        stopReceived = true;
        rotationSpeed = rSpeed; // Ensure speed is at max when broadcast is received
        isSpinInProcess = true;
    }

    public void ForceSpinTheWheel(long desiredPrize)
    {
        rotationSpeed = 0;
        isSpinInProcess = false;

        if (!isPrizeExists(desiredPrize))
            return;

        float desiredRotationZ = GetDesiredRotationZ(desiredPrize);
        Debug.LogError("desiredRotationZ : " + desiredRotationZ);

        // Set the rotation of the wheel directly to the desired angle
        transformWheel.eulerAngles = new Vector3(0, 0, desiredRotationZ);

        // Invoke the event immediately since no spinning is needed
        unityEventSpinWheelStop.Invoke();
    }

    #endregion

    #region PRIVATE_METHODS
    private float GetDesiredRotationZ(long prize)
    {
        List<int> indexPrizeList = new List<int>();

        for (int i = 0; i < prizeList.Count; i++)
        {
            if (prizeList[i] == prize)
                indexPrizeList.Add(i);
        }

        int randomIndex = Random.Range(0, indexPrizeList.Count);
        int prizeIndex = indexPrizeList[randomIndex];

        return 3.6f + (prizeIndex * 7.2f);
    }

    private bool isPrizeExists(long desiredPrize)
    {
        foreach (long prize in prizeList)
        {
            if (prize == desiredPrize)
            {
                return true;
            }
        }

        return false;
    }
    #endregion

    #region COROUTINES
    public IEnumerator CheckWheelStop()
    {
        while (isSpinInProcess)
        {
            if (isSpinInProcess)
            {
                Debug.LogError("true");
                yield return null;
            }
            else
            {
                UIManager.Instance.game1Panel.game1GamePlayPanel.wheelOfFortunePanel.WinningAnimation();
            }
        }
    }
    #endregion

    #region GETTER_SETTER
    #endregion
}