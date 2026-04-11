// Example script for drum rotation
using System.Collections;
using UnityEngine;

public class DrumRotation : MonoBehaviour
{
    public float rotationSpeed = 50f; // Adjust the speed of rotation

    public bool IsRotating = false;

    [SerializeField] private Collider2D[] colliders2D;
    [SerializeField] private Rigidbody2D[] rigidbody2D;

    void Update()
    {
        if (!IsRotating || UIManager.Instance.isBreak)
            return;

        // Rotate the circle around the Z-axis
        transform.Rotate(Vector3.back * rotationSpeed * Time.deltaTime);
    }

    public void EnableDisableColliders(bool enable)
    {
        foreach (Collider2D collider in colliders2D)
        {
            collider.enabled = enable;
        }
        foreach (Rigidbody2D rigidbody in rigidbody2D)
        {
            rigidbody.bodyType = enable ? RigidbodyType2D.Dynamic : RigidbodyType2D.Static;
        }
    }
}
