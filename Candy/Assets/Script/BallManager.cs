using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using DG.Tweening;
using TMPro;
using UnityEngine.UI;

public class BallManager : MonoBehaviour
{
    private const int RealtimeBallColumns = 15;
    private const float RealtimeBallSize = 84f;
    private const float RealtimeBallSpacingX = 86f;
    private const float RealtimeBallTopRowY = -350f;
    private const float RealtimeBallBottomRowY = -258f;

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
    [SerializeField] [Range(0.1f, 1f)] private float glassAnimationSpeedMultiplier = 0.59f;
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
    private readonly List<Animator> cachedGlassAnimators = new List<Animator>();
    private float appliedGlassAnimatorSpeed = -1f;
    private CandyBallViewBindingSet explicitViewBindings;

    private void OnEnable()
    {
        EventManager.OnGenerateBall += GenerateBall;
        EventManager.OnGenerateExtraBall += GenerateExtraBall;
        EventManager.OnPlay += ResetBalls;

        EventManager.OnTapForExtraBall += ShowExtraBallOnTap;

        ApplyExplicitRealtimeViewBindingsFromComponent();
        GetStartPosition_ExtraBalls();
        ApplyRealtimeBallSlotLayout();
        CacheBallComponentRefs();
        CacheExtraBallTextRefs();
        cachedBigBallText = ResolveBigBallText();
        CacheGlassAnimator();
        ApplyGlassAnimationSpeed(force: true);

        SetActiveIfChanged(ballOutMachineAnimParent, true);
        SetActiveIfChanged(bigBallImg != null ? bigBallImg.gameObject : null, false);

        SetActiveIfChanged(ballMachine, false);
        SetActiveIfChanged(extraBallMachine, false);

        CacheRealtimeBallLayoutPositions();


    }

    private void Start()
    {
        // Ensure speed sync after all Awake calls and scene activation.
        ApplyGlassAnimationSpeed(force: true);
    }

    private void Update()
    {
        ApplyGlassAnimationSpeed();
    }

    private void CacheGlassAnimator()
    {
        if (cachedGlassAnimators.Count > 0)
        {
            return;
        }

        if (ballOutMachineAnimParent == null)
        {
            return;
        }

        Animator[] animators = ballOutMachineAnimParent.GetComponentsInChildren<Animator>(true);
        if (animators == null || animators.Length == 0)
        {
            return;
        }

        for (int i = 0; i < animators.Length; i++)
        {
            Animator animator = animators[i];
            if (animator != null)
            {
                cachedGlassAnimators.Add(animator);
            }
        }
    }

    private void ApplyRealtimeBallSlotLayout()
    {
        if (balls == null || balls.Count == 0)
        {
            return;
        }

        for (int i = 0; i < balls.Count; i++)
        {
            GameObject ball = balls[i];
            if (ball == null)
            {
                continue;
            }

            RectTransform rootRect = ball.GetComponent<RectTransform>();
            if (rootRect != null)
            {
                int row = i / RealtimeBallColumns;
                int col = i % RealtimeBallColumns;
                float x = (col - ((RealtimeBallColumns - 1) * 0.5f)) * RealtimeBallSpacingX;
                float y = row == 0 ? RealtimeBallTopRowY : RealtimeBallBottomRowY;

                rootRect.anchorMin = new Vector2(0.5f, 0.5f);
                rootRect.anchorMax = new Vector2(0.5f, 0.5f);
                rootRect.pivot = new Vector2(0.5f, 0.5f);
                rootRect.anchoredPosition = new Vector2(x, y);
                rootRect.sizeDelta = new Vector2(RealtimeBallSize, RealtimeBallSize);
                rootRect.localScale = Vector3.one;
            }

            Image image = ball.GetComponent<Image>();
            if (image != null)
            {
                image.preserveAspect = true;
            }

            TextMeshProUGUI numberText = ball.GetComponentInChildren<TextMeshProUGUI>(true);
            if (numberText != null)
            {
                RectTransform textRect = numberText.rectTransform;
                if (textRect != null)
                {
                    textRect.anchorMin = new Vector2(0.5f, 0.5f);
                    textRect.anchorMax = new Vector2(0.5f, 0.5f);
                    textRect.pivot = new Vector2(0.5f, 0.5f);
                    textRect.anchoredPosition = Vector2.zero;
                    textRect.sizeDelta = new Vector2(RealtimeBallSize, RealtimeBallSize);
                    textRect.localScale = Vector3.one;
                }

                numberText.alignment = TextAlignmentOptions.Center;
                numberText.enableAutoSizing = true;
                numberText.fontSizeMin = Mathf.Max(18f, numberText.fontSizeMin);
                numberText.fontSizeMax = Mathf.Max(numberText.fontSizeMin + 8f, 44f);
                numberText.overflowMode = TextOverflowModes.Overflow;
            }
        }
    }

    private void ApplyGlassAnimationSpeed(bool force = false)
    {
        if (cachedGlassAnimators.Count == 0)
        {
            return;
        }

        // Keep a stable visual speed even when global testing Time.timeScale is > 1.
        float visualSpeed = Mathf.Clamp(glassAnimationSpeedMultiplier, 0.1f, 1f);
        float timeScaleCompensation = Mathf.Max(0.01f, Time.timeScale);
        float desiredSpeed = visualSpeed / timeScaleCompensation;

        if (!force && Mathf.Abs(appliedGlassAnimatorSpeed - desiredSpeed) < 0.001f)
        {
            return;
        }

        for (int i = 0; i < cachedGlassAnimators.Count; i++)
        {
            Animator animator = cachedGlassAnimators[i];
            if (animator != null)
            {
                animator.speed = desiredSpeed;
            }
        }

        appliedGlassAnimatorSpeed = desiredSpeed;
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
        ApplyExplicitRealtimeViewBindingsFromComponent();
        TryAutoResolveBallsFromHierarchy();
        ApplyRealtimeBallSlotLayout();

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
            CandyBallSlotBinding slotBinding =
                explicitViewBindings != null &&
                explicitViewBindings.Slots != null &&
                i < explicitViewBindings.Slots.Count
                    ? explicitViewBindings.Slots[i]
                    : null;
            cachedBallImages.Add(slotBinding != null ? slotBinding.Image : (ball != null ? ball.GetComponent<Image>() : null));

            TextMeshProUGUI label = slotBinding != null
                ? slotBinding.NumberText
                : (transformRef != null ? transformRef.GetComponentInChildren<TextMeshProUGUI>(true) : null);

            cachedBallTexts.Add(label);
        }
    }

    private void TryAutoResolveBallsFromHierarchy()
    {
        if (explicitViewBindings != null && explicitViewBindings.Slots != null && explicitViewBindings.Slots.Count > 0)
        {
            return;
        }

        if (balls != null && balls.Count > 0)
        {
            return;
        }

        if (ballMachine == null)
        {
            return;
        }

        Image[] images = ballMachine.GetComponentsInChildren<Image>(true);
        if (images == null || images.Length == 0)
        {
            return;
        }

        SortedDictionary<int, GameObject> numberedBalls = new SortedDictionary<int, GameObject>();
        List<GameObject> fallbackBalls = new List<GameObject>();
        HashSet<int> seenInstanceIds = new HashSet<int>();

        for (int i = 0; i < images.Length; i++)
        {
            Image image = images[i];
            if (image == null)
            {
                continue;
            }

            GameObject candidate = image.gameObject;
            if (candidate == null)
            {
                continue;
            }

            if (bigBallImg != null && candidate == bigBallImg.gameObject)
            {
                continue;
            }

            if (extraBalls != null && extraBalls.Contains(candidate))
            {
                continue;
            }

            if (candidate.transform.childCount == 0)
            {
                continue;
            }

            if (candidate.GetComponentInChildren<TextMeshProUGUI>(true) == null)
            {
                continue;
            }

            int instanceId = candidate.GetInstanceID();
            if (!seenInstanceIds.Add(instanceId))
            {
                continue;
            }

            if (int.TryParse(candidate.name, out int parsedOrder))
            {
                if (!numberedBalls.ContainsKey(parsedOrder))
                {
                    numberedBalls.Add(parsedOrder, candidate);
                }
            }
            else
            {
                fallbackBalls.Add(candidate);
            }
        }

        List<GameObject> resolved = new List<GameObject>(numberedBalls.Count + fallbackBalls.Count);
        foreach (KeyValuePair<int, GameObject> pair in numberedBalls)
        {
            resolved.Add(pair.Value);
        }

        for (int i = 0; i < fallbackBalls.Count; i++)
        {
            resolved.Add(fallbackBalls[i]);
        }

        if (resolved.Count == 0)
        {
            return;
        }

        balls = resolved;
        if (verboseDrawLogging)
        {
            Debug.Log($"[BallManager] Auto-resolved {balls.Count} ball object(s) from scene hierarchy.");
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
        TextMeshProUGUI text = tr != null
            ? tr.GetComponentInChildren<TextMeshProUGUI>(true)
            : null;

        cachedExtraBallTexts[obj] = text;
    }

    TextMeshProUGUI ResolveBigBallText()
    {
        explicitViewBindings = explicitViewBindings != null
            ? explicitViewBindings
            : GetComponent<CandyBallViewBindingSet>();

        if (explicitViewBindings != null && explicitViewBindings.BigBallText != null)
        {
            cachedBigBallText = explicitViewBindings.BigBallText;
            return cachedBigBallText;
        }

        if (cachedBigBallText != null)
        {
            return cachedBigBallText;
        }

        if (bigBallImg == null || bigBallImg.transform.childCount == 0)
        {
            return null;
        }

        cachedBigBallText = bigBallImg.GetComponentInChildren<TextMeshProUGUI>(true);
        return cachedBigBallText;
    }

    public void ApplyExplicitRealtimeViewBindingsFromComponent()
    {
        explicitViewBindings = explicitViewBindings != null
            ? explicitViewBindings
            : GetComponent<CandyBallViewBindingSet>();

        if (explicitViewBindings == null)
        {
            return;
        }

        if (explicitViewBindings.BigBallImage != null)
        {
            bigBallImg = explicitViewBindings.BigBallImage;
        }

        if (explicitViewBindings.BallOutMachineAnimParent != null)
        {
            ballOutMachineAnimParent = explicitViewBindings.BallOutMachineAnimParent;
        }

        if (explicitViewBindings.BallMachine != null)
        {
            ballMachine = explicitViewBindings.BallMachine;
        }

        if (explicitViewBindings.ExtraBallMachine != null)
        {
            extraBallMachine = explicitViewBindings.ExtraBallMachine;
        }

        if (explicitViewBindings.Slots != null && explicitViewBindings.Slots.Count > 0)
        {
            if (balls == null)
            {
                balls = new List<GameObject>(explicitViewBindings.Slots.Count);
            }
            else
            {
                balls.Clear();
            }

            for (int i = 0; i < explicitViewBindings.Slots.Count; i++)
            {
                balls.Add(explicitViewBindings.Slots[i] != null ? explicitViewBindings.Slots[i].Root : null);
            }
        }

        if (explicitViewBindings.ExtraBalls != null)
        {
            if (extraBalls == null)
            {
                extraBalls = new List<GameObject>(explicitViewBindings.ExtraBalls.Count);
            }
            else
            {
                extraBalls.Clear();
            }

            for (int i = 0; i < explicitViewBindings.ExtraBalls.Count; i++)
            {
                extraBalls.Add(explicitViewBindings.ExtraBalls[i]);
            }
        }

        cachedBigBallText = explicitViewBindings.BigBallText;
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
        ApplyExplicitRealtimeViewBindingsFromComponent();
        TryAutoResolveBallsFromHierarchy();
        CacheBallComponentRefs();

        TMP_FontAsset numberFallbackFont = RealtimeTextStyleUtils.ResolveFallbackFont();
        CacheRealtimeBallLayoutPositions();

        SetActiveIfChanged(ballOutMachineAnimParent, true);
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
            else
            {
                APIManager.instance?.ReportRealtimeRenderMismatch("draw received but no big ball text target", asError: true);
            }
        }

        if (balls == null || balls.Count == 0)
        {
            return;
        }

        int slotIndex = drawIndex;
        if (slotIndex < 0)
        {
            slotIndex = 0;
        }
        else if (slotIndex >= balls.Count)
        {
            slotIndex %= balls.Count;
        }

        GameObject ballObject = balls[slotIndex];
        if (ballObject == null)
        {
            return;
        }

        SetActiveIfChanged(ballObject, true);

        int spriteIndex = (ballSprite != null && ballSprite.Count > 0) ? Random.Range(0, ballSprite.Count) : -1;
        if (spriteIndex >= 0)
        {
            Image img = slotIndex < cachedBallImages.Count ? cachedBallImages[slotIndex] : ballObject.GetComponent<Image>();
            if (img != null)
            {
                img.sprite = ballSprite[spriteIndex];
            }
        }

        TextMeshProUGUI tmp = slotIndex < cachedBallTexts.Count ? cachedBallTexts[slotIndex] : null;
        TextMeshProUGUI bigBallLabel = ResolveBigBallText();
        if (tmp != null)
        {
            if (!tmp.gameObject.activeSelf)
            {
                tmp.gameObject.SetActive(true);
            }

            RealtimeTextStyleUtils.ApplyBallNumber(tmp, drawnNumber.ToString(), numberFallbackFont);
            APIManager.instance?.RegisterRealtimeBallRendered(
                drawnNumber,
                slotIndex,
                cachedBallTexts.Count,
                tmp,
                bigBallLabel);
        }
        else
        {
            APIManager.instance?.ReportRealtimeRenderMismatch(
                $"draw received but no ball text target for slot {slotIndex}",
                asError: true);
        }

        Transform ballTransform = slotIndex < cachedBallTransforms.Count ? cachedBallTransforms[slotIndex] : null;
        if (ballTransform == null)
        {
            ballTransform = ballObject.transform;
        }

        if (ballTransform != null && slotIndex < realtimeBallLayoutPositions.Count)
        {
            ballTransform.localPosition = realtimeBallLayoutPositions[slotIndex];
        }
    }

    void GenerateBall(List<int> _ballIndexList)
    {
        if (APIManager.instance != null && APIManager.instance.UseRealtimeBackend)
        {
            APIManager.instance.ReportLegacyVisualWriteAttempt("BallManager.GenerateBall");
            return;
        }

        //Debug.Log(_ballIndexList.Count);
        ballIndexList = _ballIndexList;
        //debug.Log()
        TryAutoResolveBallsFromHierarchy();
        CacheBallComponentRefs();
        bool realtimeMode = APIManager.instance != null && APIManager.instance.UseRealtimeBackend;
        SetActiveIfChanged(ballOutMachineAnimParent, realtimeMode);

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
        if (APIManager.instance != null && APIManager.instance.UseRealtimeBackend)
        {
            APIManager.instance.ReportLegacyVisualWriteAttempt("BallManager.GenerateExtraBall");
            return;
        }

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

        SetActiveIfChanged(ballOutMachineAnimParent, true);
    }


}
