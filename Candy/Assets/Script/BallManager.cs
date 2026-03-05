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
    private int[] extraBallPosArr = new int[5] { -140, -70, 140, 70, 0 };
    private List<GameObject> instantiatedExtraBall = new List<GameObject>();
    private readonly List<Vector3> realtimeBallLayoutPositions = new List<Vector3>();

    private void OnEnable()
    {
        EventManager.OnGenerateBall += GenerateBall;
        EventManager.OnGenerateExtraBall += GenerateExtraBall;
        EventManager.OnPlay += ResetBalls;

        EventManager.OnTapForExtraBall += ShowExtraBallOnTap;

        GetStartPosition_ExtraBalls();

        ballOutMachineAnimParent.SetActive(true);
        bigBallImg.gameObject.SetActive(false);

        if(ballMachine != null)
        	ballMachine.SetActive(false);
        if(extraBallMachine != null)
        	extraBallMachine.SetActive(false);

        CacheRealtimeBallLayoutPositions();


    }

    private void OnDisable()
    {
        EventManager.OnGenerateBall -= GenerateBall;
        EventManager.OnGenerateExtraBall -= GenerateExtraBall;
        EventManager.OnPlay -= ResetBalls;
        EventManager.OnTapForExtraBall -= ShowExtraBallOnTap;

    }


    void GetStartPosition_ExtraBalls()
    {
        for(int i = 0; i< extraBalls.Count; i++)
        {
            extraBaStartPos[i] = extraBalls[i].transform.localPosition;
            extraBalls[i].SetActive(false);
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
            realtimeBallLayoutPositions.Add(balls[i].transform.localPosition);
        }
    }

    public void ShowRealtimeDrawBall(int drawIndex, int drawnNumber)
    {
        if (balls == null || drawIndex < 0 || drawIndex >= balls.Count)
        {
            return;
        }

        CacheRealtimeBallLayoutPositions();

        if (ballMachine != null)
        {
            ballMachine.SetActive(true);
        }

        if (extraBallMachine != null)
        {
            extraBallMachine.SetActive(false);
        }

        if (bigBallImg != null)
        {
            bigBallImg.gameObject.SetActive(true);
            int bigSpriteIndex = (bigBallSprite != null && bigBallSprite.Count > 0) ? Random.Range(0, bigBallSprite.Count) : -1;
            if (bigSpriteIndex >= 0)
            {
                bigBallImg.sprite = bigBallSprite[bigSpriteIndex];
            }

            Transform bigBallText = bigBallImg.transform.childCount > 0 ? bigBallImg.transform.GetChild(0) : null;
            if (bigBallText != null)
            {
                TextMeshProUGUI tmp = bigBallText.GetComponent<TextMeshProUGUI>();
                if (tmp != null)
                {
                    tmp.text = drawnNumber.ToString();
                }
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
            Image img = ballObject.GetComponent<Image>();
            if (img != null)
            {
                img.sprite = ballSprite[spriteIndex];
            }
        }

        Transform child = ballObject.transform.childCount > 0 ? ballObject.transform.GetChild(0) : null;
        if (child != null)
        {
            TextMeshProUGUI tmp = child.GetComponent<TextMeshProUGUI>();
            if (tmp != null)
            {
                tmp.text = drawnNumber.ToString();
            }
        }

        if (drawIndex < realtimeBallLayoutPositions.Count)
        {
            ballObject.transform.localPosition = realtimeBallLayoutPositions[drawIndex];
        }

        ballObject.SetActive(true);
    }

    void GenerateBall(List<int> _ballIndexList)
    {
        //Debug.Log(_ballIndexList.Count);
        ballIndexList = _ballIndexList;
        //debug.Log()
        ballOutMachineAnimParent.SetActive(false);

        AddRandomBallSprites();
        StartCoroutine(StartBallAnim());
    }



    void ShowExtraBallOnTap(bool isExtraBallLeft)
    {
        if(extraBallMachine != null)
        	extraBallMachine.SetActive(isExtraBallLeft);
        bigBallImg.gameObject.SetActive(false);
        if(ballMachine != null)
        	ballMachine.SetActive(!isExtraBallLeft);
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
        Debug.Log("___showFreeExtraBall ------: "+ showFreeExtraBall);
        ballIndexList = _ballIndexList;
        if (showFreeExtraBall)
        {
            Debug.Log("Show Extra Ball : "+ ballIndexList.Count);

            StartCoroutine(StartExtaBallAnim(ballIndexList, showExtraBall));        //For Auto show 5 extra balls
        }//StartCoroutine(StartExtaBallAnim(showExtraBall, ballIndex++));            //For Tap and show extra ball
        else
        {
            StartExtaBallAnim(showExtraBall, ballIndex++);
        }
    }

    void AddRandomBallSprites()
    {
        for(int i = 0; i< balls.Count; i++)
        {
            int ballSpriteIndex = Random.Range(0, ballSprite.Count);
            bigBallSpriteSequence.Add(bigBallSprite[ballSpriteIndex]);

            balls[i].transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = ballIndexList[i].ToString();
            balls[i].GetComponent<Image>().sprite = ballSprite[ballSpriteIndex];
        }
    }

 

    IEnumerator StartBallAnim()
    {
        if (!bigBallImg.isActiveAndEnabled)
        {
            ballMachine.SetActive(true);
            extraBallMachine.SetActive(false);
            bigBallImg.gameObject.SetActive(true);
        }
        for (int i = 0; i < balls.Count; i++)
        {
            bigBallImg.sprite = bigBallSpriteSequence[i];
            bigBallImg.transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = ballIndexList[i].ToString();


            balls[i].transform.localPosition = new Vector2(0, 100);
            balls[i].SetActive(true);
            yield return new WaitForSeconds(numberGenerator.ballAnimSpeed);
            if (i < 15)
                balls[i].transform.DOLocalMoveY(-350, numberGenerator.ballAnimSpeed);
            else
                balls[i].transform.DOLocalMoveY(-280, numberGenerator.ballAnimSpeed);
            
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
                        balls[i].transform.DOLocalMoveX(70 * ((i % 7) - 7), numberGenerator.ballAnimSpeed);
                    }
                    else if (i >= 7 && i < 14)
                    {
                        balls[i].transform.DOLocalMoveX(70 * (7 - (i % 7)), numberGenerator.ballAnimSpeed);
                    }
                    else if ((i > 14 && i <= 21))
                    {
                        if (i == 21)
                        {
                            balls[i].transform.DOLocalMoveX(-70, numberGenerator.ballAnimSpeed);
                        }
                        else
                        {
                            balls[i].transform.DOLocalMoveX(70 * ((i % 7) - 7 - 1), numberGenerator.ballAnimSpeed);
                        }
                    }
                }
                else
                {
                    yield return new WaitForSeconds(numberGenerator.ballAnimSpeed);
                    if (i == 28)
                    {
                        balls[i].transform.DOLocalMoveX(70, numberGenerator.ballAnimSpeed);
                    }
                    else
                    {
                        balls[i].transform.DOLocalMoveX(70 * (7 + 1 - (i % 7)), numberGenerator.ballAnimSpeed);
                    }

                }
            }
        }

    }

    IEnumerator StartExtaBallAnim(List<int> ballIndexList, bool showExtraBall)
    {
        if(showExtraBall){
            //Debug.Log("StartExtrBallAnim");
            bigBallImg.sprite = extraBallSprite;
            bigBallImg.transform.GetChild(0).GetComponent<TextMeshProUGUI>().color = Color.white;
            for (int i = 0; i < ballIndexList.Count-30; i++)
            {

                bigBallImg.transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = ballIndexList[30 + i].ToString();
                Debug.Log("i : " + i);
                if (!extraBalls[i].activeInHierarchy)
                {
                    Debug.Log(ballIndexList[30 + i]);
                    extraBalls[i].transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = ballIndexList[30 + i].ToString(); //NumberGenerator.generatedNO[30+i]
                    //extraBalls[i].transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = ballIndexList[ballIndexList.Count-1].ToString(); //NumberGenerator.generatedNO[30+i]

                    extraBalls[i].transform.localPosition = new Vector2(0, 100);
                    extraBalls[i].SetActive(true);
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

        bigBallImg.gameObject.SetActive(false);
        bigBallImg.transform.GetChild(0).GetComponent<TextMeshProUGUI>().color = Color.black;
        EventManager.AutoSpinOver(true);
    }


    void StartExtaBallAnim(bool showExtraBall, int index)
    {
        if (showExtraBall)
        {
            if (instantiatedExtraBall.Count == 0 || instantiatedExtraBall.Count-1 < index)
            {
                GameObject g = Instantiate(ballPrefab, extraBallParent);
                g.GetComponent<Image>().sprite = ballSprite[Random.Range(0, ballSprite.Count)];
                

                StartCoroutine(ModifyExtraBallPos(g, index));
                instantiatedExtraBall.Add(g);
            }
            else
            {
                StartCoroutine(ModifyExtraBallPos(instantiatedExtraBall[index], index));
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

    IEnumerator ModifyExtraBallPos(GameObject g, int index)
    {
        g.transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = ballIndexList[ballIndexList.Count - 1].ToString();
        g.transform.localPosition = new Vector2(0, 150);
        g.SetActive(true);

       // yield return new WaitForSeconds(numberGenerator.ballAnimSpeed);

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
            g.transform.DOLocalMoveX(extraBallPosArr[index % 5], numberGenerator.ballAnimSpeed);

        }
        yield return new WaitForSeconds(numberGenerator.ballAnimSpeed);
        EventManager.ShowBallOnCard(ballIndexList.Count - 1);
    }

    public void ResetBalls()
    {
        if (extraBallMachine != null)
        {
            extraBallMachine.SetActive(false);
        }

        StopAllCoroutines();
        if (balls != null)
        {
            foreach (var e in balls)
            {
                if (e != null)
                {
                    e.SetActive(false);
                }
            }
        }

        if (extraBalls != null)
        {
            foreach (var e in extraBalls)
            {
                if (e != null)
                {
                    e.SetActive(false);
                }
            }
        }

        ballIndex = 0;
        foreach (var g in instantiatedExtraBall)
        {
            if (g != null)
            {
                g.SetActive(false);
            }
        }

        if (bigBallImg != null)
        {
            bigBallImg.gameObject.SetActive(false);
        }

        if (ballMachine != null)
        {
            ballMachine.SetActive(false);
        }
    }


}
