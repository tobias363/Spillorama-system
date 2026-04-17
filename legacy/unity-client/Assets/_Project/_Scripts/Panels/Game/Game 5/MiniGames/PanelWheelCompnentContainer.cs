using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PanelWheelCompnentContainer : MonoBehaviour
{
    [Header("Game5RouletteWheelController")]
    [SerializeField] private Game5RouletteWheelController game5RouletteWheelController;

    public int SampleInput;

    public void StartSpin()
    {
        //game5RouletteWheelController.SpinWheel(SampleInput, () =>
        //{
        //    Debug.Log("Spinning completed!");
        //});
    }   
}
