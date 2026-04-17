using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PanelWheelCompnentContainer : MonoBehaviour
{
    [Header("Game5RouletteWheelController")]
    [SerializeField] private Game5RouletteWheelController game5RouletteWheelController;

    [SerializeField] private int SampleInput;

    public void StartSpin()
    {
        // TODO: Replace with Spillorama roulette spin
        Debug.LogWarning("[Game5] StartSpin: Spillorama endpoint not yet implemented");
    }   
}
