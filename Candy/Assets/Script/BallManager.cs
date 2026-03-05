using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using DG.Tweening;
using TMPro;
using UnityEngine.UI;

public class BallManager : MonoBehaviour
{
    public NumberGenerator numberGenerator;
    public List<GameObject> balls;
    public List<Sprite> ballSprite;
    public GameObject ballPrefab;
    public Transform extraBallParent;
    public Sprite extraBallSprite;

    public GameObject ballOutMachineAnimParent;
    public Image bigBallImg;
    public GameObject ballMachine;
    public GameObject extraBallMachine;
    public List<Sprite> bigBallSprite;
    private List<Sprite> bigBallSpriteSequence = new List<Sprite>();
    public List<GameObject> extraBalls;
    private Vector3[] extraBaStartPos = new Vector3[5]; 
    public float ballAnimSpeed = 0.11f;

    [SerializeField]
    private List<int> ballIndexList = new List<int>();
    [SerializeField] private bool verboseDrawLogging = false;
    private int[] extraBallPosArr = new int[5] { -140, -70, 140, 70, 0 };
    private List<GameObject> instantiatedExtraBall = new List<GameObject>();
    private readonly List<Vector3> realtimeBallLayoutPositions = new List<Vector3>();
    private readonly List<Transform> cachedBallTransforms = new List<Transform>();
    private readonly List<Image> cachedBallImages = new List<Image>();
    private readonly List<TextMeshProUGUI> cachedBallTexts = new List<TextMeshProUGUI>();
    private readonly Dictionary<GameObject, TextMeshProUGUI> cachedExtraBallTexts = new Dictionary<GameObject, TextMeshProUGUI>();
    private readonly Dictionary<GameObject, Coroutine> extraBallMoveRoutines = new Dictionary<GameObject, Coroutine>();
    private Coroutine ballAnimationRoutine;
    private Coroutine extraBallBatchRoutine;
    private TextMeshProUGUI cachedBigBallText;

    private void OnEnable()
    {
        EventManager.OnGenerateBall += GenerateBall;
        EventManager.OnGenerateExtraBall += GenerateExtraBall;
        EventManager.OnPlay += ResetBalls;

        EventManager.OnTapForExtraBall += ShowExtraBallOnTap;

        GetStartPosition_ExtraBalls();
        CacheBallComponentRefs();
        CacheExtraBallTextRefs();
        cachedBigBallText = ResolveBigBallText();

        SetActiveIfChanged(ballOutMachineAnimParent, true);
        SetActiveIfChanged(bigBallImg != null ? bigBallImg.gameObject : null, false);

        SetActiveIfChanged(ballMachine, false);
        SetActiveIfChanged(extraBallMachine, false);

        CacheRealtimeBallLayoutPositions();


    }

    private void OnDisable()
    {
        EventManager.OnGenerateBall -= GenerateBall;
        EventManager.OnGenerateExtraBall -= GenerateExtraBall;
        EventManager.OnPlay -= ResetBalls;
        EventManager.OnTapForExtraBall -= ShowExtraBallOnTap;

        if (ballAnimationRoutine != null)
        {
            StopCoroutine(ballAnimationRoutine);
            ballAnimationRoutine = null;
        }

        if (extraBallBatchRoutine != null)
        {
            StopCoroutine(extraBallBatchRoutine);
            extraBallBatchRoutine = null;
        }

        foreach (Coroutine routine in extraBallMoveRoutines.Values)
        {
            if (routine != null)
            {
                StopCoroutine(routine);
            }
        }
        extraBallMoveRoutines.Clear();

    }


    void GetStartPosition_ExtraBalls()
    {
        for(int i = 0; i< extraBalls.Count; i++)
        {
            extraBaStartPos[i] = extraBalls[i].transform.localPosition;
            SetActiveIfChanged(extraBalls[i], false);
        }
    }

    void CacheBallComponentRefs()
    {
        cachedBallTransforms.Clear();
        cachedBallImages.Clear();
        cachedBallTexts.Clear();

        if (balls == null)
        {
            return;
        }

        for (int i = 0; i < balls.Count; i++)
        {
            GameObject ball = balls[i];
            Transform transformRef = ball != null ? ball.transform : null;
            cachedBallTransforms.Add(transformRef);
            cachedBallImages.Add(ball != null ? ball.GetComponent<Image>() : null);

            TextMeshProUGUI label = null;
            if (transformRef != null && transformRef.childCount > 0)
            {
                label = transformRef.GetChild(0).GetComponent<TextMeshProUGUI>();
            }

            cachedBallTexts.Add(label);
        }
    }

    void CacheExtraBallTextRefs()
    {
        cachedExtraBallTexts.Clear();
        if (extraBalls == null)
        {
            return;
        }

        for (int i = 0; i < extraBalls.Count; i++)
        {
            CacheExtraBallText(extraBalls[i]);
        }
    }

    void CacheExtraBallText(GameObject obj)
    {
        if (obj == null || cachedExtraBallTexts.ContainsKey(obj))
        {
            return;
        }

        Transform tr = obj.transform;
        TextMeshProUGUI text = null;
        if (tr != null && tr.childCount > 0)
        {
            text = tr.GetChild(0).GetComponent<TextMeshProUGUI>();
        }

        cachedExtraBallTexts[obj] = text;
    }

    TextMeshProUGUI ResolveBigBallText()
    {
        if (cachedBigBallText != null)
        {
            return cachedBigBallText;
        }

        if (bigBallImg == null || bigBallImg.transform.childCount == 0)
        {
            return null;
        }

        cachedBigBallText = bigBallImg.transform.GetChild(0).GetComponent<TextMeshProUGUI>();
        return cachedBigBallText;
    }

    static void SetActiveIfChanged(GameObject obj, bool active)
    {
        if (obj != null && obj.activeSelf != active)
        {
            obj.SetActive(active);
        }
    }

    static void KillTransformTweens(Transform target)
    {
        if (target != null)
        {
            target.DOKill(false);
        }
    }

    void CacheRealtimeBallLayoutPositions()
    {
        if (balls == null || balls.Count == 0)
        {
            return;
        }

        if (realtimeBallLayoutPositions.Count == balls.Count)
        {
            return;
        }

        realtimeBallLayoutPositions.Clear();
        for (int i = 0; i < balls.Count; i++)
        {
            Transform transformRef = i < cachedBallTransforms.Count ? cachedBallTransforms[i] : balls[i].transform;
            realtimeBallLayoutPositions.Add(transformRef != null ? transformRef.localPosition : Vector3.zero);
        }
    }

    public void ShowRealtimeDrawBall(int drawIndex, int drawnNumber)
    {
        if (balls == null || drawIndex < 0 || drawIndex >= balls.Count)
        {
            return;
        }

        TMP_FontAsset numberFallbackFont = RealtimeTextStyleUtils.ResolveFallbackFont();
        CacheRealtimeBallLayoutPositions();

        SetActiveIfChanged(ballMachine, true);
        SetActiveIfChanged(extraBallMachine, false);

        if (bigBallImg != null)
        {
            SetActiveIfChanged(bigBallImg.gameObject, true);
            int bigSpriteIndex = (bigBallSprite != null && bigBallSprite.Count > 0) ? Random.Range(0, bigBallSprite.Count) : -1;
            if (bigSpriteIndex >= 0)
            {
                bigBallImg.sprite = bigBallSprite[bigSpriteIndex];
            }

            TextMeshProUGUI bigBallText = ResolveBigBallText();
            if (bigBallText != null)
            {
                RealtimeTextStyleUtils.ApplyBallNumber(bigBallText, drawnNumber.ToString(), numberFallbackFont);
            }
        }

        GameObject ballObject = balls[drawIndex];
        if (ballObject == null)
        {
            return;
        }

        int spriteIndex = (ballSprite != null && ballSprite.Count > 0) ? Random.Range(0, ballSprite.Count) : -1;
        if (spriteIndex >= 0)
        {
            Image img = drawIndex < cachedBallImages.Count ? cachedBallImages[drawIndex] : ballObject.GetComponent<Image>();
            if (img != null)
            {
                img.sprite = ballSprite[spriteIndex];
            }
        }

        TextMeshProUGUI tmp = drawIndex < cachedBallTexts.Count ? cachedBallTexts[drawIndex] : null;
        if (tmp != null)
        {
            RealtimeTextStyleUtils.ApplyBallNumber(tmp, drawnNumber.ToString(), numberFallbackFont);
        }

        Transform ballTransform = drawIndex < cachedBallTransforms.Count ? cachedBallTransforms[drawIndex] : ballObject.transform;
        if (drawIndex < realtimeBallLayoutPositions.Count)
        {
            ballTransform.localPosition = realtimeBallLayoutPositions[drawIndex];
        }

        SetActiveIfChanged(ballObject, true);
    }

    void GenerateBall(List<int> _ballIndexList)
    {
        //Debug.Log(_ballIndexList.Count);
        ballIndexList = _ballIndexList;
        //debug.Log()
        SetActiveIfChanged(ballOutMachineAnimParent, false);

        AddRandomBallSprites();
        if (ballAnimationRoutine != null)
        {
            StopCoroutine(ballAnimationRoutine);
        }

        ballAnimationRoutine = StartCoroutine(StartBallAnim());
    }



    void ShowExtraBallOnTap(bool isExtraBallLeft)
    {
        SetActiveIfChanged(extraBallMachine, isExtraBallLeft);
        SetActiveIfChanged(bigBallImg != null ? bigBallImg.gameObject : null, false);
        SetActiveIfChanged(ballMachine, !isExtraBallLeft);
        if (isExtraBallLeft)
        {
            for (int i = 0; i < 4; i++)
            {

                EventManager.ShowMissingPL(i, true);
            }
        }

        
    }

    int ballIndex = 0;
    void GenerateExtraBall(List<int> _ballIndexList, bool showExtraBall, bool showFreeExtraBall)
    {
        if (verboseDrawLogging)
        {
            Debug.Log("___showFreeExtraBall ------: " + showFreeExtraBall);
        }

        ballIndexList = _ballIndexList;
        if (showFreeExtraBall)
        {
            if (verboseDrawLogging)
            {
                Debug.Log("Show Extra Ball : " + ballIndexList.Count);
            }

            if (extraBallBatchRoutine != null)
            {
                StopCoroutine(extraBallBatchRoutine);
            }

            extraBallBatchRoutine = StartCoroutine(StartExtaBallAnim(ballIndexList, showExtraBall));        //For Auto show 5 extra balls
        }//StartCoroutine(StartExtaBallAnim(showExtraBall, ballIndex++));            //For Tap and show extra ball
        else
        {
            StartExtaBallAnim(showExtraBall, ballIndex++);
        }
    }

    void AddRandomBallSprites()
    {
        TMP_FontAsset numberFallbackFont = RealtimeTextStyleUtils.ResolveFallbackFont();
        bigBallSpriteSequence.Clear();
        int count = Mathf.Min(balls.Count, ballIndexList.Count);
        for(int i = 0; i < count; i++)
        {
            int ballSpriteIndex = Random.Range(0, ballSprite.Count);
            bigBallSpriteSequence.Add(bigBallSprite[ballSpriteIndex]);

            TextMeshProUGUI numberText = i < cachedBallTexts.Count ? cachedBallTexts[i] : null;
            RealtimeTextStyleUtils.ApplyBallNumber(numberText, ballIndexList[i].ToString(), numberFallbackFont);

            Image img = i < cachedBallImages.Count ? cachedBallImages[i] : null;
            if (img != null)
            {
                img.sprite = ballSprite[ballSpriteIndex];
            }
        }
    }

 

    IEnumerator StartBallAnim()
    {
        TMP_FontAsset numberFallbackFont = RealtimeTextStyleUtils.ResolveFallbackFont();
        if (!bigBallImg.isActiveAndEnabled)
        {
            SetActiveIfChanged(ballMachine, true);
            SetActiveIfChanged(extraBallMachine, false);
            SetActiveIfChanged(bigBallImg.gameObject, true);
        }

        TextMeshProUGUI bigBallText = ResolveBigBallText();
        int count = Mathf.Min(balls.Count, ballIndexList.Count);
        for (int i = 0; i < count; i++)
        {
            bigBallImg.sprite = bigBallSpriteSequence[i];
            RealtimeTextStyleUtils.ApplyBallNumber(bigBallText, ballIndexList[i].ToString(), numberFallbackFont);


            Transform ballTransform = i < cachedBallTransforms.Count ? cachedBallTransforms[i] : balls[i].transform;
            ballTransform.localPosition = new Vector2(0, 100);
            SetActiveIfChanged(balls[i], true);
            yield return new WaitForSeconds(numberGenerator.ballAnimSpeed);
            KillTransformTweens(ballTransform);
            if (i < 15)
                ballTransform.DOLocalMoveY(-350, numberGenerator.ballAnimSpeed);
            else
                ballTransform.DOLocalMoveY(-280, numberGenerator.ballAnimSpeed);
            
            EventManager.ShowBallOnCard(i);

            if (i == 14 || i == 29)
            {
                yield return null;
            }
            else {
                if (i <= 21)
                {
                    yield return new WaitForSeconds(numberGenerator.ballAnimSpeed);
                    if (i < 7)
                    {
                        KillTransformTweens(ballTransform);
                        ballTransform.DOLocalMoveX(70 * ((i % 7) - 7), numberGenerator.ballAnimSpeed);
                    }
                    else if (i >= 7 && i < 14)
                    {
                        KillTransformTweens(ballTransform);
                        ballTransform.DOLocalMoveX(70 * (7 - (i % 7)), numberGenerator.ballAnimSpeed);
                    }
                    else if ((i > 14 && i <= 21))
                    {
                        if (i == 21)
                        {
                            KillTransformTweens(ballTransform);
                            ballTransform.DOLocalMoveX(-70, numberGenerator.ballAnimSpeed);
                        }
                        else
                        {
                            KillTransformTweens(ballTransform);
                            ballTransform.DOLocalMoveX(70 * ((i % 7) - 7 - 1), numberGenerator.ballAnimSpeed);
                        }
                    }
                }
                else
                {
                    yield return new WaitForSeconds(numberGenerator.ballAnimSpeed);
                    if (i == 28)
                    {
                        KillTransformTweens(ballTransform);
                        ballTransform.DOLocalMoveX(70, numberGenerator.ballAnimSpeed);
                    }
                    else
                    {
                        KillTransformTweens(ballTransform);
                        ballTransform.DOLocalMoveX(70 * (7 + 1 - (i % 7)), numberGenerator.ballAnimSpeed);
                    }

                }
            }
        }

        ballAnimationRoutine = null;
    }

    IEnumerator StartExtaBallAnim(List<int> ballIndexList, bool showExtraBall)
    {
        TMP_FontAsset numberFallbackFont = RealtimeTextStyleUtils.ResolveFallbackFont();
        if(showExtraBall){
            //Debug.Log("StartExtrBallAnim");
            bigBallImg.sprite = extraBallSprite;
            TextMeshProUGUI bigBallText = ResolveBigBallText();
            if (bigBallText != null)
            {
                bigBallText.color = Color.white;
            }
            for (int i = 0; i < ballIndexList.Count-30; i++)
            {
                RealtimeTextStyleUtils.ApplyBallNumber(bigBallText, ballIndexList[30 + i].ToString(), numberFallbackFont);
                if (bigBallText != null)
                {
                    bigBallText.color = Color.white;
                }
                if (!extraBalls[i].activeInHierarchy)
                {
                    TextMeshProUGUI extraBallText = cachedExtraBallTexts.TryGetValue(extraBalls[i], out TextMeshProUGUI cachedText)
                        ? cachedText
                        : null;
                    RealtimeTextStyleUtils.ApplyBallNumber(extraBallText, ballIndexList[30 + i].ToString(), numberFallbackFont); //NumberGenerator.generatedNO[30+i]
                    //extraBalls[i].transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = ballIndexList[ballIndexList.Count-1].ToString(); //NumberGenerator.generatedNO[30+i]

                    extraBalls[i].transform.localPosition = new Vector2(0, 100);
                    SetActiveIfChanged(extraBalls[i], true);
                    KillTransformTweens(extraBalls[i].transform);
                    extraBalls[i].transform.DOLocalMove(extraBaStartPos[i], ballAnimSpeed);
                    numberGenerator.totalExtraBallCount--;
                    numberGenerator.extraBallCountText.text = numberGenerator.totalExtraBallCount.ToString();
                    yield return new WaitForSeconds(ballAnimSpeed + 0.5f);
                    EventManager.ShowBallOnCard(30 + i);
                }
            }
        }
        //NumberGenerator.isExtraBallDone = true;
        for (int i = 0; i < 4; i++)
        {
            EventManager.ShowMissingPL(i, true);
        }

        SetActiveIfChanged(bigBallImg.gameObject, false);
        TextMeshProUGUI resetBigBallText = ResolveBigBallText();
        if (resetBigBallText != null)
        {
            resetBigBallText.color = Color.black;
        }
        EventManager.AutoSpinOver(true);
        extraBallBatchRoutine = null;
    }


    void StartExtaBallAnim(bool showExtraBall, int index)
    {
        if (showExtraBall)
        {
            if (instantiatedExtraBall.Count == 0 || instantiatedExtraBall.Count-1 < index)
            {
                GameObject g = Instantiate(ballPrefab, extraBallParent);
                g.GetComponent<Image>().sprite = ballSprite[Random.Range(0, ballSprite.Count)];
                CacheExtraBallText(g);
                StartExtraBallMoveRoutine(g, index);
                instantiatedExtraBall.Add(g);
            }
            else
            {
                StartExtraBallMoveRoutine(instantiatedExtraBall[index], index);
            }
            //extraBalls[index].transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = ballIndexList[ballIndexList.Count - 1].ToString(); //NumberGenerator.generatedNO[30+i]

            //extraBalls[index].transform.localPosition = new Vector2(0, 100);
            //extraBalls[index].SetActive(true);
            //extraBalls[index].transform.DOLocalMove(extraBaStartPos[index], ballAnimSpeed);
            //yield return new WaitForSeconds(ballAnimSpeed + 0.5f);
            //EventManager.ShowBallOnCard(ballIndexList.Count - 1);


            ////extraBalls[i].transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = ballIndexList[30 + i].ToString(); //NumberGenerator.generatedNO[30+i]
            //extraBalls[index].transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = ballIndexList[ballIndexList.Count - 1].ToString(); //NumberGenerator.generatedNO[30+i]

            //extraBalls[index].transform.localPosition = new Vector2(0, 100);
            //extraBalls[index].SetActive(true);
            //extraBalls[index].transform.DOLocalMove(extraBaStartPos[index], ballAnimSpeed);
            //yield return new WaitForSeconds(ballAnimSpeed + 0.5f);
            //EventManager.ShowBallOnCard(ballIndexList.Count-1);

        }
        //NumberGenerator.isExtraBallDone = true;
        // Debug.Log("FA");
        for (int i = 0; i < 4; i++)
        {
            EventManager.ShowMissingPL(i, true);
        }
    }

    void StartExtraBallMoveRoutine(GameObject target, int index)
    {
        if (target == null)
        {
            return;
        }

        if (extraBallMoveRoutines.TryGetValue(target, out Coroutine existing) && existing != null)
        {
            StopCoroutine(existing);
        }

        Coroutine routine = StartCoroutine(ModifyExtraBallPos(target, index));
        extraBallMoveRoutines[target] = routine;
    }

    IEnumerator ModifyExtraBallPos(GameObject g, int index)
    {
        TMP_FontAsset numberFallbackFont = RealtimeTextStyleUtils.ResolveFallbackFont();
        CacheExtraBallText(g);
        TextMeshProUGUI extraBallText = cachedExtraBallTexts.TryGetValue(g, out TextMeshProUGUI cachedText) ? cachedText : null;
        RealtimeTextStyleUtils.ApplyBallNumber(extraBallText, ballIndexList[ballIndexList.Count - 1].ToString(), numberFallbackFont);
        g.transform.localPosition = new Vector2(0, 150);
        SetActiveIfChanged(g, true);

       // yield return new WaitForSeconds(numberGenerator.ballAnimSpeed);

        KillTransformTweens(g.transform);
        if (index < 5)
            g.transform.DOLocalMoveY(-235 + 100, numberGenerator.ballAnimSpeed);
        else if (index < 10)
            g.transform.DOLocalMoveY(-165 + 100, numberGenerator.ballAnimSpeed);
        else if (index < 15)
            g.transform.DOLocalMoveY(-95 + 100, numberGenerator.ballAnimSpeed);
        else
            g.transform.DOLocalMoveY(-25 + 100, numberGenerator.ballAnimSpeed);

        yield return new WaitForSeconds(numberGenerator.ballAnimSpeed);
        //Debug.Log(g.transform.localPosition.y);
        if ((index + 1) % 5 == 0)
        {
            yield return null;
        }
        else
        {
            KillTransformTweens(g.transform);
            g.transform.DOLocalMoveX(extraBallPosArr[index % 5], numberGenerator.ballAnimSpeed);

        }
        yield return new WaitForSeconds(numberGenerator.ballAnimSpeed);
        EventManager.ShowBallOnCard(ballIndexList.Count - 1);
        extraBallMoveRoutines.Remove(g);
    }

    public void ResetBalls()
    {
        if (extraBallMachine != null)
        {
            SetActiveIfChanged(extraBallMachine, false);
        }

        StopAllCoroutines();
        ballAnimationRoutine = null;
        extraBallBatchRoutine = null;
        extraBallMoveRoutines.Clear();
        if (balls != null)
        {
            foreach (var e in balls)
            {
                if (e != null)
                {
                    KillTransformTweens(e.transform);
                    SetActiveIfChanged(e, false);
                }
            }
        }

        if (extraBalls != null)
        {
            foreach (var e in extraBalls)
            {
                if (e != null)
                {
                    KillTransformTweens(e.transform);
                    SetActiveIfChanged(e, false);
                }
            }
        }

        ballIndex = 0;
        foreach (var g in instantiatedExtraBall)
        {
            if (g != null)
            {
                KillTransformTweens(g.transform);
                SetActiveIfChanged(g, false);
            }
        }

        if (bigBallImg != null)
        {
            SetActiveIfChanged(bigBallImg.gameObject, false);
        }

        if (ballMachine != null)
        {
            SetActiveIfChanged(ballMachine, false);
        }
    }


}
