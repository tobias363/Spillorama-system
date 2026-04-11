using System.Collections;
using Assets.Plugins.Drop3DEffects.Scripts;
using UnityEngine;

public partial class UIManager
{
    public void LaunchWinningAnimation(string message = "", float waitingTime = 0)
    {
        if (message != "")
            StartCoroutine(WinningAnimationMessage(message, waitingTime));

        Animator3D anim = Animations;
        anim.ObjectPrefab = Model;
        anim.StartSpeed = 1;
        anim.Duration = 3;
        anim.Count = 100;
        anim.Run();
    }

    public void StopCloseNotification()
    {
        if (closeNotificationCoroutine != null)
        {
            StopCoroutine(closeNotificationCoroutine);
            closeNotificationCoroutine = null;
        }
    }

    public void DisplayNotificationUpperTray(string message)
    {
        StopCloseNotification();
        txtNotificationUpperTray.transform.parent.gameObject.SetActive(false);
        txtNotificationUpperTray.text = message;
        txtNotificationUpperTray.transform.parent.gameObject.SetActive(true);
        var rt = txtNotificationUpperTray.transform.parent.gameObject.GetComponent<RectTransform>();
        LeanTween.scale(rt, new Vector2(1f, 1f), 0.25f)
            .setOnComplete(() => { closeNotificationCoroutine = StartCoroutine(CloseNotificationDelayed(3f)); });
    }

    public void DisplayFirebaseNotificationUpperTray(string message)
    {
        StopCloseNotification();
        txtNotificationUpperTray2.transform.parent.gameObject.SetActive(false);
        txtNotificationUpperTray2.text = message;
        txtNotificationUpperTray2.transform.parent.gameObject.SetActive(true);
        var rt = txtNotificationUpperTray2.transform.parent.gameObject.GetComponent<RectTransform>();
        rt.anchoredPosition = new Vector2(rt.anchoredPosition.x, 220f);
        LeanTween.moveY(rt, 0f, 0.25f);
        LeanTween.scale(rt, new Vector2(1f, 1f), 0.25f);
    }

    public void CloseFirebaseNotificationUpperTray()
    {
        if (closeNotificationCoroutine != null)
        {
            StopCoroutine(closeNotificationCoroutine);
            closeNotificationCoroutine = null;
        }

        closeNotificationCoroutine = StartCoroutine(CloseNotificationDelayed(0.1f));
    }

    public void CloseNotification()
    {
        Debug.LogError("Close...................");
        var rt = txtNotificationUpperTray.transform.parent.gameObject.GetComponent<RectTransform>();
        LeanTween.scale(rt, new Vector2(0f, 0f), 0.25f)
            .setOnComplete(() => { txtNotificationUpperTray.transform.parent.gameObject.SetActive(false); });
    }

    private IEnumerator CloseNotificationDelayed(float delay)
    {
        yield return new WaitForSeconds(delay);

        if (txtNotificationUpperTray2.transform.parent.gameObject.activeSelf)
        {
            var rt2 = txtNotificationUpperTray2.transform.parent.gameObject.GetComponent<RectTransform>();
            LeanTween.scale(rt2, new Vector2(0f, 0f), 0.25f)
                .setOnComplete(() =>
                {
                    txtNotificationUpperTray2.transform.parent.gameObject.SetActive(false);
                    StopCloseNotification();
                });
        }
        else
        {
            var rt = txtNotificationUpperTray.transform.parent.gameObject.GetComponent<RectTransform>();
            LeanTween.scale(rt, new Vector2(0f, 0f), 0.25f)
                .setOnComplete(() =>
                {
                    txtNotificationUpperTray.transform.parent.gameObject.SetActive(false);
                    StopCloseNotification();
                });
        }
    }

    private IEnumerator WinningAnimationMessage(string message, float waitingTime = 0)
    {
        yield return new WaitForSeconds(waitingTime);
        DisplayNotificationUpperTray(message);
    }
}
