using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class BallScript : MonoBehaviour
{
    #region Private_Variables

    [SerializeField] private Image ballImage;
    [SerializeField] private TextMeshProUGUI text;

    [SerializeField] private float acc = 50f;
    [SerializeField] private float velocity = 80f;
    [SerializeField] private float highlightScale = 1.2f;
    
    private bool move;
    private float stopPos = 0;
    
    private RectTransform rt;
    private Vector2 v2, velocityDirection;
    private MoveDirection direction;
    #endregion

    #region Unity_Callbacks

    private void Update()
    {
        if (!move)
            return;
        
        Vector2 pos = rt.anchoredPosition;
        pos += velocity * Time.deltaTime * velocityDirection;
        velocity += acc;
        
        if (pos.y <= stopPos && direction == MoveDirection.Vertical)
        {
            pos.y = stopPos;
            rt.localScale = Vector3.one;
            move = false;
        }
        else if(pos.x >= stopPos && direction == MoveDirection.Horizontal)
        {
            pos.x = stopPos;
            move = false;
            rt.localScale = Vector3.one;
        }
        rt.anchoredPosition = pos;
    }

    #endregion
    
    #region Public_Methods
    public void SetData(BingoBallType type, int n, int index, MoveDirection direction)
    {
        ballImage.sprite = type.ballImage;
        text.text = $"{n}";
        this.direction = direction;
        
        rt = GetComponent<RectTransform>();
        rt.localScale = Vector3.one * highlightScale;
        CalculateStoppingPosition(index);
        move = true;
    }
    public void MoveOneStepDown()
    {
        Vector2 v = v2 * velocityDirection;
        stopPos += direction == MoveDirection.Horizontal? v.x : v.y;
        move = true;
    }
    #endregion

    #region Private_Methods
    private void CalculateStoppingPosition(int index)
    {
        v2 = rt.rect.size;
        switch (direction)
        {
            case MoveDirection.Horizontal:
                GetHorizontalStopPosAndVelocity(index);
                break;
            
            case MoveDirection.Vertical:
                GetVerticalStopPosAndVelocity(index);
                break;
        }
    }

    private void GetVerticalStopPosAndVelocity(int index)
    {
        stopPos = v2.y * index;
        velocityDirection = Vector2.down;
    }
    private void GetHorizontalStopPosAndVelocity(int index)
    {
        stopPos = v2.x * index * -1;
        velocityDirection = Vector2.right;
    }
    #endregion

}