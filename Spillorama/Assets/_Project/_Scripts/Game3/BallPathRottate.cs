using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class BallPathRottate : MonoBehaviour
{
    public Transform[] path; // Reference to the GameObject with the path sprite
    public float speed; // Speed of the ball movement
    private int stopAtWaypointIndex; // Index of the waypoint to stop at

    private Transform[] waypoints;
    private int currentWaypointIndex = 0;
    private bool ballSpin = false;

    [SerializeField] private RotatingObject rotatingObject;

    [Header("Roulette Wheel Plates Data")]
    [SerializeField] private int[] PlatesData;


    Action onCompleteCallback;
    private int activeTime;
    private Coroutine updateTurnCoroutine;

    void Update()
    {
        if (ballSpin)
        {
            MoveOnPath();
        }
    }



    public void StartSpin(int i)
    {
        SpinWheel(i, 10);
    }


    public void SpinWheel(int inputNumber, float rouletteTime , Action onCompleteCallback = null, bool isSpinningForce = false)
    {
        this.onCompleteCallback = onCompleteCallback;

        int roulletePathIndex = GetTargetPlateIndex(inputNumber);

        if (isSpinningForce)
        {
            

            currentWaypointIndex = path[roulletePathIndex].childCount;  /*86 + + 6 + GetTargetPlateIndex(inputNumber);*/

            waypoints = new Transform[path[roulletePathIndex].childCount];
            for (int i = 0; i < path[roulletePathIndex].childCount; i++)
            {
                waypoints[i] = path[roulletePathIndex].GetChild(i);
            }

            activeTime = (int)rouletteTime - 2;
            if (updateTurnCoroutine != null)
            {
                StopCoroutine(updateTurnCoroutine);
            }
            StopAllCoroutines();
            updateTurnCoroutine = StartCoroutine(UpdateTurn());


            this.gameObject.GetComponent<Transform>().position = waypoints[currentWaypointIndex - 1].position;
            rotatingObject.StopRotation();
            ballSpin = false;
            return;
        }

        ballSpin = true;
        currentWaypointIndex = 0;
        stopAtWaypointIndex = path[roulletePathIndex].childCount;/* 86 + +6 + GetTargetPlateIndex(inputNumber);*/
        waypoints = new Transform[path[roulletePathIndex].childCount];
        for (int i = 0; i < path[roulletePathIndex].childCount; i++)
        {
            waypoints[i] = path[roulletePathIndex].GetChild(i);
        }

        // Move the ball to the initial waypoint
        transform.position = waypoints[currentWaypointIndex].position;
        rotatingObject.StartRotation();


        activeTime = (int)rouletteTime;

        if (updateTurnCoroutine != null)
        {
            StopCoroutine(updateTurnCoroutine);
        }
        StopAllCoroutines();
        updateTurnCoroutine = StartCoroutine(UpdateTurn());
    }

    void MoveOnPath()
    {
        // Check if the ball has reached the last waypoint
        if (currentWaypointIndex >= waypoints.Length)
        {
            // If so, stop the movement
            ballSpin = false;
            return;
        }

        // Calculate the speed modifier based on the current waypoint index
        float speedModifier = 1f;
        if (currentWaypointIndex <= stopAtWaypointIndex)
        {
            speedModifier = Mathf.Clamp(1f - (float)currentWaypointIndex / stopAtWaypointIndex, 0.025f, 1f);
        }
        else if (currentWaypointIndex >= stopAtWaypointIndex)
        {
            speedModifier = Mathf.Clamp((float)(waypoints.Length - currentWaypointIndex) / (waypoints.Length - stopAtWaypointIndex), 0.1f, 2f);
        }

        // Move the ball towards the current waypoint with modified speed
        transform.position = Vector2.MoveTowards(transform.position, waypoints[currentWaypointIndex].position, speed * speedModifier * Time.deltaTime);

        // Check if the ball has reached the current waypoint
        if (Vector2.Distance(transform.position, waypoints[currentWaypointIndex].position) < 0.01f)
        {
            // Check if we need to stop at this waypoint
            if (currentWaypointIndex == stopAtWaypointIndex)
            {
                rotatingObject.StopRotation();
                ballSpin = false;
                return;
            }

            // Move to the next waypoint
            currentWaypointIndex++;
        }
    }


    private int GetTargetPlateIndex(int valueToFind)
    {

        int index = Array.IndexOf(PlatesData, valueToFind);

        if (index == -1)
        {
            Debug.LogWarning($"[BallPathRottate] Value {valueToFind} not found in PlatesData.");
            return 0;
        }

        return index;
    }

    IEnumerator UpdateTurn()
    {

        for (int i = activeTime; i >= 0; i--)
        {
            yield return new WaitForSeconds(1);

            if (i == 0)
            {
                this.onCompleteCallback?.Invoke();

                if (updateTurnCoroutine != null)
                {
                    StopCoroutine(updateTurnCoroutine);
                    updateTurnCoroutine = null; // Reset the reference
                }

                yield break;
            }
        }
    }
}
