using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Arrow : MonoBehaviour
{
    [Header("Tween Settings")]
    [SerializeField]
    private float maxRotationAngle = 30f;

    [SerializeField]
    private float impactDuration = 0.2f;

    [SerializeField]
    private float returnDuration = 0.5f;

    [Header("Dependencies")]
    [SerializeField]
    private Transform arrowPivot;

    // [SerializeField] private ParticleSystem sparkEffect;

    private float wheelAngularVelocity;

    void OnTriggerEnter2D(Collider2D collision)
    {
        if (!FortuneWheelManager.Instance._isStarted)
            return;

        // Calculate direction and force based on wheel velocity
        float direction = Mathf.Sign(wheelAngularVelocity);
        float force = Mathf.Clamp(wheelAngularVelocity * 0.1f, 0.5f, 5f);

        StartRotationTween(direction * force * maxRotationAngle);
    }

    public void UpdateWheelVelocity(float angularVelocity)
    {
        wheelAngularVelocity = angularVelocity;
    }

    private void StartRotationTween(float targetAngle)
    {
        // Create sequence for impact and return
        LeanTween
            .sequence()
            // Impact phase
            .append(
                LeanTween
                    .rotateZ(arrowPivot.gameObject, targetAngle, impactDuration)
                    .setEase(LeanTweenType.linear)
                    .setOnStart(() => {
                        // if (sparkEffect != null) sparkEffect.Play();
                    })
            )
            .append(
                LeanTween
                    .rotateZ(arrowPivot.gameObject, -2f, returnDuration)
                    .setEase(LeanTweenType.linear)
                    .setOnComplete(() =>
                    {
                        arrowPivot.localRotation = Quaternion.identity;
                    })
            );
    }
}
