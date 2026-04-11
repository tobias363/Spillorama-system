using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public partial class Game5GamePlayPanel
{
    private void GenerateRoulateBallData()
    {
        int i = 0;

        foreach (GameObject ball in balls)
        {
            TextMesh textMesh = ball.transform.GetChild(0).gameObject.GetComponent<TextMesh>();
            if (textMesh != null)
                textMesh.text = i < game5Data.rouletteData.Count ? game5Data.rouletteData[i].ToString() : "N/A";
            else
                Debug.LogError("TextMesh component not found on " + ball.name);

            i++;
        }
    }

    private void HighlightBall(int index, bool isForce = false)
    {
        if (rouletteWheel == null || balls == null || balls.Length == 0)
        {
            Debug.LogError("Please assign the Spinner and Ball GameObjects in the inspector.");
            return;
        }

        GameObject ball = balls[index];
        ball.GetComponent<Rigidbody2D>().simulated = false;
        ball.GetComponent<Collider2D>().enabled = false;

        if (isForce)
        {
            ball.SetActive(false);
            txtRoulettePlatesSelect[index].SetActive(true);
            return;
        }

        Vector3 originalScale = ball.transform.localScale;
        spriteCenterBall.gameObject.SetActive(true);
        spriteCenterBall.sprite = ball.GetComponent<SpriteRenderer>().sprite;
        spriteCenterBallText.text = ball.transform.GetChild(0).GetComponent<TextMesh>().text;
        CopyRectTransform(ball.transform.GetChild(0).GetComponent<RectTransform>(), spriteCenterBallText.GetComponent<RectTransform>());

        ball.SetActive(false);
        txtRoulettePlatesSelect[index].SetActive(true);

        float zoomOutTime = 2f;
        float zoomInTime = 0.5f;
        float ballDrawTime = game5Data.BallDrawTime / 1000f;

        if (ballDrawTime < 3 && ballDrawTime >= 2)
        {
            zoomOutTime = 1.3f;
            zoomInTime = 0.3f;
        }
        else if (ballDrawTime < 1)
        {
            zoomOutTime = 0.3f;
            zoomInTime = 0.2f;
        }

        LeanTween.scale(spriteCenterBall.gameObject, originalScale * 7f, zoomOutTime)
            .setEase(LeanTweenType.easeInOutQuad)
            .setOnComplete(() =>
            {
                LeanTween.scale(spriteCenterBall.gameObject, originalScale, zoomInTime)
                    .setEase(LeanTweenType.easeInOutQuad)
                    .setOnComplete(() => { spriteCenterBall.gameObject.SetActive(false); });
            });
    }

    private void GenerateTickets(Game5Data game5data)
    {
        foreach (var ticket in game5data.ticketList)
        {
            PrefabBingoGame5Ticket3x3 ticketObject = Instantiate(prefabBingoGame5Ticket3X3, transformTicketContainer);
            ticketObject.SetData(ticket, game5data.maximumBetAmount);
            ticketList.Add(ticketObject);
        }
    }

    private void GeneratePatterns(List<PatternList> list)
    {
        foreach (PatternList patternData in list)
        {
            PrefabBingoGame5Pattern newPattern = Instantiate(prefabBingoGame5Pattern, transformPatternContainer);
            newPattern.SetData(patternData);
            patternList.Add(newPattern);
        }
    }

    private void Reset()
    {
        TotalWithdrawCount = 0;
        txtLastWithdrawNumber.text = "--";
        roulateSpinnerElements.SetActive(UIManager.Instance.Game5ActiveElementAction());
        CloseMiniGames();
        ResetMissingTicketsData();
        ResetMissingPatternData();
        ResetPattern();
        ResetTickets();
        ResetRoulettePlats();
        ResetBall();
    }

    private void ResetTickets()
    {
        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
            Destroy(ticket.gameObject);

        ticketList.Clear();
    }

    private void ResetPattern()
    {
        foreach (PrefabBingoGame5Pattern pattern in patternList)
            Destroy(pattern.gameObject);

        patternList.Clear();
    }

    private void ResetBall()
    {
        foreach (GameObject ball in balls)
        {
            ball.GetComponent<Rigidbody2D>().simulated = true;
            ball.GetComponent<Collider2D>().enabled = true;
            ball.SetActive(true);
        }

        StartCoroutine(ResetBallCoroutine());
    }

    private IEnumerator ResetBallCoroutine()
    {
        yield return new WaitForSeconds(2f);
        roulateSpinner.EnableDisableColliders(IsGamePlayInProcess);
    }

    private void ResetRoulettePlats()
    {
        foreach (GameObject txtRoulettePlate in txtRoulettePlatesSelect)
            txtRoulettePlate.SetActive(false);
    }

    private int GetTargetPlateIndex(int valueToFind)
    {
        int[] dataArray = game5Data.rouletteData.ToArray();
        int index = System.Array.IndexOf(dataArray, valueToFind);
        return index != -1 ? index : 0;
    }

    private void CopyRectTransform(RectTransform source, RectTransform destination)
    {
        destination.anchoredPosition = source.anchoredPosition;
        destination.sizeDelta = source.sizeDelta;
        destination.anchorMin = source.anchorMin;
        destination.anchorMax = source.anchorMax;
        destination.pivot = source.pivot;
        destination.anchoredPosition3D = source.anchoredPosition3D;
        destination.localRotation = source.localRotation;
        destination.localScale = source.localScale;
    }
}
