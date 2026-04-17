using UnityEngine;

public class RotatingObject : MonoBehaviour
{
    public float rotationSpeed;
    public float decelerationRate; // Rate at which rotation speed decreases
    private bool isRotating = false;

    public float rotationAmount = 1f; // Desired rotation amount per frame

    private void Update()
    {
        if (isRotating)
        {
            // Smoothly rotate the object around its z-axis
            transform.rotation = Quaternion.Lerp(transform.rotation,
                                                  transform.rotation * Quaternion.Euler(0, 0, rotationAmount),
                                                  rotationSpeed * Time.deltaTime);

            // Gradually decrease rotation speed
            rotationSpeed -= decelerationRate * Time.deltaTime;

            // Ensure rotation speed does not go below zero
            rotationSpeed = Mathf.Max(rotationSpeed, 0f);

            // If rotation speed becomes very small or negative, stop rotation
            if (rotationSpeed <= 0.01f)
            {
                isRotating = false;
            }
        }
    }

    public void StartRotation()
    {
        if(!isRotating)
        {
            rotationSpeed = 100f; // Reset the rotation speed
            isRotating = true;
        }
        else
        {
            Debug.Log("Roullete is Rotating wait until stop");
        }
    }

    public void StopRotation()
    {
        rotationSpeed = 0f; // Reset the rotation speed
        isRotating = false;
    }
}
