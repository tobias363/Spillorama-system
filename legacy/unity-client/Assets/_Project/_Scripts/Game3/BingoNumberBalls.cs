using System;
using System.Collections.Generic;
using UnityEngine;

public class BingoNumberBalls : MonoBehaviour
{
    #region Private_Variables
    
    [SerializeField] private RectTransform ballPrefab;
    [SerializeField] private Transform ballContainer;
    
    [Header("Variables")]
    [SerializeField] private int maxBallCount = 5;
    [SerializeField] private MoveDirection direction;
    
    [Header("Ball Color/Images/Data")]
    [SerializeField] private BingoBallType[] ballTypes;

    private List<RectTransform> balls;
    private Vector2 containerSize;
    #endregion

    #region Unity_Callback

    private void OnEnable()
    {
        containerSize = ballContainer.GetComponent<RectTransform>().rect.size;
        EmptyBallContainer();
    }

    #endregion
    
    #region Publc_Methods
    public void GenerateBall(string key, int number)
    {
        
        if(balls == null)
            balls = new List<RectTransform>();

        CheckIfTubeExceededTheLimit();
        
        Transform ball = InstantiateBall();
        ball.GetComponent<BallScript>().SetData(GetBallType(key), number, balls.Count, direction);
        balls.Add(ball.GetComponent<RectTransform>());
    }
    #endregion

    #region Private_Methods

    private void MoveAllBallsOneStepDown()
    {
        foreach (RectTransform ball in balls)
        {
            ball.GetComponent<BallScript>().MoveOneStepDown();
        }
        
        GameObject go = balls[0].gameObject;
        balls.RemoveAt(0);
        Destroy(go);
    }
    
    private void EmptyBallContainer()
    {
        for (int i = 0; i < ballContainer.childCount; i++)
        {
            Destroy(ballContainer.GetChild(i).gameObject);
        }
    }
    
    private Transform InstantiateBall()
    {
        RectTransform t = Instantiate(ballPrefab, ballContainer, true);
        t.localPosition = Vector3.zero;
        t.localScale = Vector3.one;
        
        Anchors anc = direction == MoveDirection.Horizontal ? Anchors.right : Anchors.bottom;
        t.anchorMin = anc.Min;
        t.anchorMax = anc.Max;
        t.pivot = GetNewPivot();
        t.anchoredPosition = GetNewPosition();
        
        return t;
    }

    private Vector2 GetNewPivot()
    {
        if(direction == MoveDirection.Horizontal)
            return  new Vector2(1f, 0.5f);
        
        if(direction == MoveDirection.Vertical)
            return  new Vector2(0.5f, 0f);

        return Vector2.zero;
    }

    private Vector2 GetNewPosition()
    {
        if(direction == MoveDirection.Horizontal)
            return  new Vector2(-containerSize.x, 0);
        
        if(direction == MoveDirection.Vertical)
            return new Vector2(0, containerSize.y);

        return Vector2.zero;
    }

    private BingoBallType GetBallType(string key)
    {
        return Array.Find(ballTypes, x => x.typeKey == key);
    }
    
    private void CheckIfTubeExceededTheLimit()
    {
        if (balls.Count >= maxBallCount)
        {
            MoveAllBallsOneStepDown();
        }
    }
    #endregion
}

public enum MoveDirection
{
    Horizontal,
    Vertical
}

[Serializable]
public struct BingoBallType
{
    public string typeName;
    public string typeKey;
    public Sprite ballImage;
}

public struct Anchors
{
    public Vector2 Min;
    public Vector2 Max;

    public static Anchors top
    {
        get
        {
            Anchors top = new Anchors();
            top.Min = new Vector2(0.5f, 1);
            top.Max = new Vector2(0.5f, 1);

            return top;
        }
    }
    public static Anchors bottom
    {
        get
        {
            Anchors bottom = new Anchors();
            bottom.Min = new Vector2(0.5f, 0);
            bottom.Max = new Vector2(0.5f, 0);

            return bottom;
        }
    }
    public static Anchors left
    {
        get
        {
            Anchors left = new Anchors();
            left.Min = new Vector2(0, 0.5f);
            left.Max = new Vector2(0, 0.5f);

            return left;
        }
    }
    public static Anchors right
    {
        get
        {
            Anchors right = new Anchors();
            right.Min = new Vector2(1, 0.5f);
            right.Max = new Vector2(1, 0.5f);

            return right;
        }
    }
}