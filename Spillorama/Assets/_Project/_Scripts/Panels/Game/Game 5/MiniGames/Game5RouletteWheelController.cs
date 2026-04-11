using System;
using UnityEditor;
using UnityEngine;

public class Game5RouletteWheelController : MonoBehaviour
{

    // Define an enum to represent your options
    public enum WheelDirection
    {
        RightRotate,
        LeftRotate,
    }

    public bool isSpinning = false;

    [Header("Wheel direction")]
    // Create a serialized property for the enum
    public WheelDirection wheelDirection;

    [Header("Roulette Wheel Round")]
    [Range(0, 100)] // Adjust the range as needed
    public int rouletteRounCount = 5;

        
    [Header("Roulette Wheel Speed Controller")]
    public float rouletteSpeedStart = 10;
    public float rouletteSpeedBetween = 20;

    [Header("Roulette Wheel Time Controller")]
    public float rouletteTime = 10;// Adjust this value to control the spin time

    [Header("Ball Handler")]
    public Game5RouletteWheelController Game5RouletteWheelBall;
    [SerializeField] private bool thisContainBall;


    [Header("Roulette Wheel Plates Data")]
    [SerializeField] private int[] PlatesData;

    [Header("Roulette Wheel Plates Data")]
    [SerializeField] private float[] PlatesVectorValues;


    [Header("Plate Balls")]
    public GameObject[] PlateBalls;


    public void SpinWheel(int inputNumber,float rouletteTime = 10, System.Action onCompleteCallback = null , bool isSpinningForce = false)
    {

        for (int i= 0; i < PlateBalls.Length; i++)
        {
            PlateBalls[i].SetActive(false);
        }

        if (isSpinningForce)
            isSpinning = false;

        if (isSpinning)
            return;

        gameObject.transform.localRotation = Quaternion.identity;

        isSpinning = true;

        if (thisContainBall)
            Game5RouletteWheelBall.gameObject.SetActive(true);

        // Set & Spin Ball
        if (thisContainBall)
            Game5RouletteWheelBall.SpinWheel(inputNumber, rouletteTime , () =>{
                Game5RouletteWheelBall.gameObject.SetActive(false);
                PlateBalls[GetTargetPlateIndex(inputNumber)].SetActive(true);
                Debug.Log(GetTargetPlateIndex(inputNumber));
                onCompleteCallback?.Invoke();
            } , isSpinningForce);

        // Apply rotation animation
        LeanTween.rotateZ(gameObject, GetTargetRotations(inputNumber), rouletteTime)
                .setEase(LeanTweenType.easeOutCubic)
                .setOnComplete(() =>
                {
                    isSpinning = false;
                    onCompleteCallback?.Invoke();
                });
    }

    private float GetTargetRotations(int Input)
    {

        if (thisContainBall)
        {

            float targetRotation = 0;

            targetRotation = +(transform.rotation.eulerAngles.z + 1800 + 90f);

            //if (isRightRotate())
            //    targetRotation = - (transform.rotation.eulerAngles.z + 1800 + Random.Range(0f, 360f));
            //else
            //    targetRotation = + (transform.rotation.eulerAngles.z + 1800 + Random.Range(0f, 360f));
            return targetRotation;
        }
        else
        {

            float targetRotation = -(transform.rotation.eulerAngles.z + 1800 + (PlatesVectorValues[GetTargetPlateIndex(Input)]));
            return targetRotation;
        }
    }

    private int GetTargetPlateIndex(int valueToFind)
    {

        int index = Array.IndexOf(PlatesData, valueToFind);

        if (index != -1)
        {
            //Debug.Log($"Value {valueToFind} found at index: {index}");
        }
        else
        {
            Debug.Log($"Value {valueToFind} not found in the array.");
            return 0;
        }

        return index;
    }
}

