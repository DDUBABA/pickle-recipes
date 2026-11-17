import {body,json} from '../../lib/http.js';
import {validateFeedback,FEEDBACK_MAX_BYTES} from '../../lib/feedback.js';

export async function onRequest(context){
  if(context.request.method!=='POST'){
    const response=json({ok:false,code:'METHOD_NOT_ALLOWED',message:'POST 요청을 사용해 주세요.'},405);
    response.headers.set('Allow','POST, OPTIONS');return response;
  }
  const feedback=validateFeedback(await body(context.request,FEEDBACK_MAX_BYTES));
  const feedbackId=crypto.randomUUID(),createdAt=new Date().toISOString();
  await context.env.DB.prepare(`INSERT INTO feedbacks(feedback_id,category,title,content,submitted_by,created_at)
    VALUES(?,?,?,?,?,?)`).bind(feedbackId,feedback.category,feedback.title,feedback.content,feedback.submittedBy,createdAt).run();
  return json({ok:true,feedbackId,createdAt,message:'문의가 접수되었습니다. 접수번호를 보관해 주세요.'},201);
}
