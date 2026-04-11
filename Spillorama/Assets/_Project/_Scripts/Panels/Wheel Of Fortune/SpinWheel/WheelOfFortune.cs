using System.Collections.Generic;
using UnityEngine;

public class WheelOfFortune : MonoBehaviour
{
    [SerializeField] private List<long> prizeList;
    [SerializeField] private Transform circle;
    public WheelCategories allData;
    public List<float> _sectorsAngles;
    public List<long> currentData;
    public float spinSpeed = 500f; // Initial spin speed
    public float slowDownDuration = 2f; // Time to smoothly stop
    public float targetAngle = 0f; // Target angle to stop at
    private bool isSpinning = false;
    private bool isStopping = false;
    private float currentSpeed;
    private float stoppingTime;
    private float initialAngle;
    private float totalRotationToTarget;

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.V) && !isSpinning && !isStopping)
        {
            StartSpin();
        }

        if (Input.GetKeyDown(KeyCode.Q) && isSpinning)
        {
            StartStop();
        }

        if (isSpinning)
        {
            circle.Rotate(0, 0, -currentSpeed * Time.deltaTime);
        }

        if (isStopping)
        {
            SmoothStop();
        }
    }

    void StartSpin()
    {
        currentData.Clear();
        _sectorsAngles.Clear();
        for (int i = 0; i < prizeList.Count; i++)
        {
            currentData.Add(prizeList[i]);
            allData.categoryPies[i].GetComponent<CategoryPie>().winPoint.text = prizeList[i].ToString();
            _sectorsAngles.Add(allData.categoryPies[i].transform.eulerAngles.z);
        }
        isSpinning = true;
        currentSpeed = spinSpeed;
    }

    void StartStop()
    {
        isSpinning = false;
        isStopping = true;
        stoppingTime = Time.time;
        initialAngle = NormalizeAngle(circle.eulerAngles.z);

        // Calculate a random target angle for the desired prize
        float desiredRotationZ = GetDesiredRotationZ(3000); // Replace 3000 with the desired prize
        targetAngle = NormalizeAngle(Random.Range(desiredRotationZ - 3.25f, desiredRotationZ + 3.25f));

        // Calculate the total rotation to the target, ensuring clockwise movement
        if (targetAngle < initialAngle)
        {
            totalRotationToTarget = (360f - initialAngle) + targetAngle;
        }
        else
        {
            totalRotationToTarget = targetAngle - initialAngle;
        }
    }


    void SmoothStop()
    {
        float elapsedTime = Time.time - stoppingTime;
        float progress = Mathf.Clamp01(elapsedTime / slowDownDuration);

        // Smoothly interpolate the angle using Mathf.SmoothStep
        float smoothAngle = Mathf.LerpAngle(
            initialAngle,
            initialAngle + totalRotationToTarget,
            Mathf.SmoothStep(0f, 1f, progress)
        );

        circle.rotation = Quaternion.Euler(0f, 0f, smoothAngle);

        // End the stopping process when the target is reached
        if (progress >= 1f)
        {
            isStopping = false;
            circle.rotation = Quaternion.Euler(0f, 0f, targetAngle);
        }
    }

    private float GetDesiredRotationZ(long prize)
    {
        List<int> indexPrizeList = new List<int>();

        for (int i = 0; i < prizeList.Count; i++)
        {
            if (prizeList[i] == prize)
                indexPrizeList.Add(i);
        }

        // If no matching prize is found, return a fallback value
        if (indexPrizeList.Count == 0)
        {
            Debug.LogWarning("No prize matched. Defaulting to 0 rotation.");
            return 0f;
        }

        int randomIndex = Random.Range(0, indexPrizeList.Count);
        int prizeIndex = indexPrizeList[randomIndex];

        // Adjust angles based on your wheel's sector layout
        return prizeIndex * 360f / prizeList.Count; // Assuming equal sectors
    }

    private float NormalizeAngle(float angle)
    {
        angle %= 360f;
        return angle < 0f ? angle + 360f : angle;
    }

}